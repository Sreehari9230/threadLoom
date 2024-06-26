
const CartItem = require('../models/cartModel')
const Product = require('../models/productModel');


//for loading cart
const loadCart = async (req, res) => {
  const userId = req.session.user_id;
  try {
    //for finding CartItem
    const cartItems = await CartItem.find({ user: userId }).populate('products.productId');
    const today = new Date();

    let totalPrice = 0;
    // products offer
    const productsWithOffers = await Product.find({ isUnlisted: false })
      .populate({ path: "category", populate: { path: "offer" } })
      .populate('offer');

    // cart items
    for (const item of cartItems) {
      // products
      for (const product of item.products) {

        // Find  offer and category offer
        const productWithOffer = productsWithOffers.find(p => p._id.equals(product.productId._id));

        if (!productWithOffer) {
          console.error("Product not found in products:", product.productId._id);
          continue;
        }
        let productTotal = 0;

        let productPricePerUnit = product.price;

        // Check product offer
        if (productWithOffer.offer && productWithOffer.offer.endingDate >= today) {

          // Apply product offer
          productPricePerUnit -= (productPricePerUnit * productWithOffer.offer.discount) / 100;
        }
        //check  category  offer
        if (productWithOffer.category.offer && productWithOffer.category.offer.endingDate >= today) {

          // Apply category offer
          productPricePerUnit -= (productPricePerUnit * productWithOffer.category.offer.discount) / 100;

        }
        productTotal = productPricePerUnit * product.quantity;
        product.price = productPricePerUnit;
        product.total = productTotal;
        // Add the discounted price to the total
        totalPrice += productTotal;
      }
    }



    res.render('cart', { req: req, cartItems, totalPrice });
  } catch (error) {
    console.log(error.message);
    res.status(500).json({ message: error.message });
  }
};






//for add product to cart 

const addToCart = async (req, res) => {
  const { productId, name, quantity, price } = req.body;

  if (!productId || !name || !quantity || !price) {
    return res.status(400).json({ message: 'Missing required fields' });
  }

  const userId = req.session.user_id;
  if (!userId) {
    return res.status(401).json({ message: 'You must be logged in to add items to your cart.' });
  }

  try {
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    if (quantity > product.stockCount) {
      return res.status(400).json({ message: 'Insufficient stock' });
    }

    let cartItem = await CartItem.findOne({ user: userId });
    if (!cartItem) {
      cartItem = new CartItem({
        user: userId,
        products: [{ productId, name, price, quantity, total: price * quantity }],
      })
      await cartItem.save();
    } else {
      const existingProductIndex = cartItem.products.findIndex(p => p.productId.equals(productId));
      if (existingProductIndex !== -1) {
        const existingProduct = cartItem.products[existingProductIndex];
        if (existingProduct.quantity + quantity > product.stockCount) {
          return res.status(400).json({ message: 'Insufficient stock' });
        }
        existingProduct.quantity += quantity;
        existingProduct.total += price * quantity;
        await cartItem.save();
      } else {
        cartItem.products.push({ productId, name, price, quantity, total: price * quantity });
        await cartItem.save();
      }
    }
    console.log("Product added to cart successfully")
    res.status(200).json({
      status: true,
      message: 'Product added to cart successfully'

    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};





//for listing product in cart
const listProductsInCart = async (req, res) => {
  try {
    const cartItems = await CartItem.find().populate('productId')
    res.status(200).json(cartItems)

  } catch (error) {
    res.status(500).json({ message: error.message });
  }

}





//for removeing  product from the cart
const removeFromCart = async (req, res) => {
  try {

    const { id } = req.params;
    const userId = req.session.user_id;
    const cartItem = await CartItem.findOneAndUpdate(
      { user: userId },
      { $pull: { products: { _id: id } } },
      { new: true }
    );
    if (!cartItem) {
      return res.status(404).send('Item not found in cart');
    }
    const remainingItems = cartItem.products.length;
    if(remainingItems === 0){
      await CartItem.deleteMany({ user: userId });
    }
    res.status(200).json({ status: true, message: 'Cart item removed successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};





//for clear all product in the cart
const clearCart = async (req, res) => {

  const userId = req.session.user_id;
  try {

    const result = await CartItem.deleteMany({ user: userId });

    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'No cart items found to clear' });
    }
    res.status(200).json({ status: true, message: 'Cart cleared successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
};





//update the quantity
const updateQuantity = async (req, res) => {
  const { itemId } = req.params;
  const { quantity } = req.body;

  try {
    const cartItem = await CartItem.findOne({ 'products._id': itemId }).populate('products.productId');

    if (!cartItem) {
      return res.status(404).json({ message: 'Cart item not found' });
    }
    // Check product stock count
    const product = cartItem.products.find(p => p._id.toString() === itemId);

    // Check if product is available
    if (!product || !product.productId) {
      return res.status(400).json({ message: 'Product not found' });
    }


    // Check if quantity is greater than the product stock count
    if (quantity > product.productId.stockCount) {
      return res.status(400).json({ message: 'Requested quantity exceeds available stock' });
    }
    product.quantity = quantity;
    product.total = quantity * product.price;

    await cartItem.save();
    return res.status(200).json({ status: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}




//for apply coupon
const applyCoupon = async (req, res) => {
  try {
    const userId = req.session.user_id
    const { couponId } = req.body;
    const cartItem = await CartItem.findOneAndUpdate(
      { user: userId },
      { $set: { coupondiscount: couponId } },
      { new: true }
    );

    if (!cartItem) {
      return res.status(404).json({ message: 'Cart item not found' });
    }



    return res.status(200).json({ status: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}





//for remove the coupon
const removeCoupon = async (req, res) => {
  const userId = req.session.user_id;
  const { couponId } = req.body;

  try {
    // Find the cart item by user ID and coupon ID
    const cartItem = await CartItem.findOne({ user: userId, coupondiscount: couponId });

    if (!cartItem) {
      return res.status(404).send('Cart item not found');
    }

    // Remove the coupon discount
    cartItem.coupondiscount = null;
    await cartItem.save();

    return res.status(200).json({ status: true });

  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}








module.exports = {
  addToCart,
  loadCart,
  listProductsInCart,
  removeFromCart,
  clearCart,
  updateQuantity,
  applyCoupon,
  removeCoupon

} 