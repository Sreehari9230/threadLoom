const CartItems = require('../models/cartModel');
const Address = require('../models/addressModel');
const Order = require('../models/orderModel');
const paypal = require('paypal-rest-sdk');
const Product = require('../models/productModel')
const mongoose = require('mongoose')
const Wallet = require('../models/walletModel')
const axios = require('axios')




// Create PayPal environment
paypal.configure({
    'mode': process.env.PAYPAL_MODE,
    'client_id': process.env.PAYPAL_CLIENT_ID,
    'client_secret': process.env.PAYPAL_CLIENT_SECRET
});

//Function to generate a random orderId
function generateRandomString(length) {
    const numberSet = '0123456789';

    let result = 'threadLoom';
    for (let i = 0; i < length; i++) {
        const randomIndex = Math.floor(Math.random() * numberSet.length);
        result += numberSet.charAt(randomIndex);
    }
    return result;
}

// Function to fetch exchange rate from INR to USD
const fetchExchangeRate = async () => {
    try {
        const response = await axios.get('https://api.exchangerate-api.com/v4/latest/INR');
        console.log("response", response.data.rates.USD)
        return response.data.rates.USD;
    } catch (error) {
        console.error('Error fetching exchange rate:', error);
        throw new Error('Error fetching exchange rate');
    }
}


// Function to truncate description if it exceeds PayPal's limits
function truncateDescription(description) {
    const maxLength = 127; // Maximum length allowed by PayPal
    if (description.length > maxLength) {
        return description.substring(0, maxLength); // Truncate description
    }
    return description;
}


//for checkout process
const checkout = async (req, res) => {
    const userId = req.session.user_id;
    try {
        const cartItems = await CartItems.find({ user: userId }).populate('products.productId');
        let totalPrice = 0;
        cartItems.forEach(item => {
            item.products.forEach(product => {
                totalPrice += product.price * product.quantity;
            });
        });
        const address = await Address.find({ userId: userId });

        res.render('checkout', { req, cartItems, totalPrice, address });

    } catch (error) {
        console.error(error.message);
        return res.status(500).json({ success: false, message: 'Internal Server Error. Please try again later.' });
    }
};



//for place order
const placeOrder = async (req, res) => {
    try {
        const userId = req.session.user_id;
        const { items, total, addressId, paymentMethod } = req.body;
        const address = await Address.findById(addressId);
        if (!address) {
            return res.status(404).json({ message: 'Address not found.' });
        }
        const expectedDelivery = new Date();
        expectedDelivery.setDate(expectedDelivery.getDate() + 5);
        const randomOrderId = generateRandomString(5);
        if (paymentMethod !== 'cod' && paymentMethod !== 'paypal') {
            return res.status(400).json({ message: 'Invalid payment method.' });
        }


        for (const item of items) {
            for (const productDetail of item.products) {
                // Ensure productDetail.productId is defined before accessing its _id
                if (!productDetail.productId) {
                    return res.status(400).json({ message: `Product ID is undefined for item ${item._id}.` });
                }
                const productId = productDetail.productId._id;
                const product = await Product.findById(productId);

                if (!product) {
                    return res.status(404).json({ message: `Product with ID ${productId} not found.` });
                }

                if (product.stockCount < productDetail.quantity) {
                    return res.status(400).json({ message: `Insufficient stock for product ${product.name}.` });
                }

                product.stockCount -= productDetail.quantity;
                await product.save();
                console.log("Quantity decreased");
            }
        }


        const orderItems = items.flatMap((item) => {
            return item.products.map(productDetail => ({
                productId: productDetail.productId._id,
                quantity: productDetail.quantity,
                price: productDetail.price,
                total: productDetail.price * productDetail.quantity,
            }));
        });




        // Check if the payment method is PayPal
        if (paymentMethod === 'paypal') {

            // Calculate the total amount for each item's products
            const itemTotalAmount = items.flatMap((item) => {
                // Calculate the total amount for each item's products
                const itemTotal = item.products.reduce((total, productDetail) => total + (productDetail.price * productDetail.quantity), 0);
                return itemTotal;
            });



            const exchangeRate = await fetchExchangeRate();
            const itemTotal = itemTotalAmount * exchangeRate;

            // Save order details
            const order = new Order({
                userId: userId,
                ordersId: randomOrderId,
                deliveryAddress: address.toObject(),
                totalAmount: parseFloat(total),
                expectedDelivery: expectedDelivery,
                paymentMethod: paymentMethod,
                total: total,
                items: orderItems
            });

            // Save the order to the database
            const savedOrder = await order.save();
            console.log("savedOrder")
            const orderId = savedOrder._id;


            // Create PayPal payment request
            const create_payment_json = {
                "intent": "sale",
                "payer": {
                    "payment_method": "paypal"
                },
                "redirect_urls": {
                    "return_url": process.env.BASE_URL + `/order/paymentSuccess/${orderId}`,
                    "cancel_url": process.env.BASE_URL + `/order/paymentCancel/${orderId}`
                },
                "transactions": [{
                    "item_list": {
                        "items": items.flatMap(item => {
                            // Map each product within an item
                            return item.products.map(productDetail => ({
                                "name": productDetail.productId.name,
                                "description": truncateDescription(productDetail.productId.description),
                                "quantity": productDetail.quantity,
                                "price": (productDetail.price * exchangeRate).toFixed(2),
                                "currency": "USD"
                            }));
                        }).flat()
                    },
                    "amount": {
                        "currency": "USD",
                        "total": itemTotal.toFixed(2)
                    },
                    "description": "Order summary of the product.",

                }],
                application_context: {
                    shipping_preference: "NO_SHIPPING",
                    brand_name: "threadloom"
                }

            };



            // Create PayPal payment  
            const createPayPalPayment = new Promise((resolve, reject) => {
                paypal.payment.create(create_payment_json, function (error, payment) {
                    if (error) {
                        reject(error);
                    } else {
                        // Assuming payerId is part of the payment response
                        const payerId = payment.payer.payer_id;

                        // Redirect user to paymentSuccess with payerId as a query parameter
                        const approvalUrl = payment.links.find(link => link.rel === 'approval_url').href;
                        const paymentSuccessUrl = `${approvalUrl}?payerId=${payerId}`;

                        resolve(paymentSuccessUrl);
                    }
                });
            });

            const paymentSuccessUrl = await createPayPalPayment;
            return res.status(200).json({ approvalUrl: paymentSuccessUrl });

        } else if (paymentMethod === 'cod') {

            const order = new Order({
                userId: userId,
                ordersId: randomOrderId,
                deliveryAddress: address.toObject(),
                totalAmount: parseFloat(total),
                expectedDelivery: expectedDelivery,
                paymentMethod: paymentMethod,
                total: total,
                items: orderItems
            });
            await order.save();

            console.log("Order placed successfully.")
            // Clear cart
            await CartItems.deleteMany({ user: userId });

            return res.status(200).json({
                status: true,
                orderId: order._id,
                message: 'Order placed successfully. Payment will be collected upon delivery.'
            });
        }

    } catch (error) {
        console.error('Error placing order:', error);
        res.status(500).json({ message: 'Error placing order', error: error.message });
    }
}





// For payment success
const paymentSuccess = async (req, res) => {
    try {
        const userId = req.session.user_id;
        const orderId = req.params.orderId;
        if (!orderId) {
            return res.status(400).json({ success: false, message: 'Order Id is missing.' });
        }

        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(400).json({ success: false, message: 'Order is not found.' });
        }
        order.status = 'paid';

        const paymentId = req.query.paymentId;
        const payerId = req.query.PayerID;
        order.paymentId = paymentId;

        // Check if payerId is provided
        if (payerId) {
            order.payerId = payerId;
        } else {
            console.log("payerId not provided");

        }

        await order.save();

        console.log("Paypal order Sucessfull.",);
        // Clear cart
        await CartItems.deleteMany({ user: userId });
        res.render('paymentSuccess', { req, orderId });

    } catch (error) {
        console.error('Error in payment success:', error);
        res.status(500).send('Server Error');
    }
};







// For payment cancellation
const paymentCancel = async (req, res) => {
    try {
        const orderId = req.params.orderId;

        if (!orderId) {
            return res.status(400).send('Order ID is missing.');
        }
        const order = await Order.findById(orderId);
        if (!order) {
            return res.status(404).send('Order not found.');
        }
        order.status = 'retry';
        res.render('paymentCancel', { req, orderId });

    } catch (error) {
        console.error('Error in payment cancellation:', error);
        res.status(500).send('Server Error');
    }
};









//to show order deatils 
const orderDetails = async (req, res) => {
    try {
        const orderId = req.params.id;
        const productId = req.query.productId
        const productIdObject = new mongoose.Types.ObjectId(productId);
        const order = await Order.findById(orderId).populate('items.productId');

        let OtherOrders = []
        let selectedItem = null;
        for (const item of order.items) {
            if (productIdObject.toString() == item.productId._id.toString()) {
                selectedItem = item;

            } else {
                OtherOrders.push(item)

            }
        }

        if (!order) {
            return res.status(404).send('Order not found');
        }
        res.render('orderDeatil', { req, order, OtherOrders, selectedItem });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};







//this is for order confirmation
const orderConfirmation = async (req, res) => {
    try {
        const orderId = req.params.orderId;
        const order = await Order.findById(orderId).populate('userId').populate('items.productId');
        if (!order) {
            return res.status(404).send('Order not found');
        }
        res.render('orderConfirmation', { req, order });
    } catch (error) {
        console.error(error);
        res.status(500).send('Server Error');
    }
};







//this is for oder cancellation
const cancelOrder = async (req, res) => {
    try {
        const userId = req.session.user_id;
        const { orderId, itemId } = req.params;
        const { cancellationReason } = req.body;
        const order = await Order.findById(orderId).populate('items.productId');

        if (!order) {
            return res.status(404).json({ success: false, message: 'Order not found.' });
        }

        const item = order.items.find(item => item._id.toString() === itemId);
        if (!item) {
            return res.status(404).json({ success: false, message: 'Item not found.' });
        }
        item.cancellationReason = cancellationReason;

        item.orderStatus = 'cancelled';

        await order.save();
        //for updating the product quantity
        const items = order.items;
        for (const item of items) {
            const product = await Product.findById(item.productId)

            if (!product) {
                return res.status(404).json({ message: `Product with ID ${item.productId} not found.` });
            }

            product.stockCount += item.quantity;
            await product.save()
            console.log("Quantity increased")

        }
        if (order.status == 'paid') {
            const wallet = await Wallet.findOne({ userId })
            if (!wallet) {
                // If the wallet doesn't exist, create a new one
                const newWallet = new Wallet({
                    userId,
                    balance: item.total,
                    transactions: [{
                        type: 'credit',
                        amount: item.total,
                        date: new Date(),
                        orderId,
                        itemId,
                        description: `Refund for order cancellation`
                    }]
                });
                await newWallet.save();

            } else {
                wallet.balance += item.total;

                wallet.transactions.push({
                    type: 'credit',
                    amount: item.total,
                    date: new Date(),
                    orderId,
                    itemId,
                    description: `Refund for order cancellation`
                });
                await wallet.save();
            }


        }

        res.json({ success: true, message: 'Product cancelled successfully.' });
    } catch (error) {
        console.error('Error in /cancel/:orderId route:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
};









module.exports = {
    checkout,
    placeOrder,
    orderDetails,
    orderConfirmation,
    cancelOrder,
    paymentSuccess,
    paymentCancel
}


