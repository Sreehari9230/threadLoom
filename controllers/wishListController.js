const WishList = require('../models/wishListModel')



//for the whishlist
const loadWishlist = async (req, res) => {
  try {
    const userId = req.session.user_id;
    console.log("userId", userId);
    const wishlist = await WishList.find({ user: userId }).populate('productId');
    console.log("wishlist", wishlist);

    res.render('wishList', { req, wishlist })
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}



//for add to wish  list 
const addToWishList = async (req, res) => {
  console.log("entered");

  const userId = req.session.user_id;
  console.log("userId", userId);
  const { productId } = req.params;
  console.log("productId", productId);

  if (!userId) {
    return res.status(401).json({ message: 'You must be logged in to add items to your cart.' });
  }
  try {

    const existingItem = await WishList.findOne({ user: userId, item: productId })
    if (existingItem) {
      return res.status(400).json({ message: 'Item already in wishlist' });
    }
    const wishListItem = new WishList({
      user: userId,
      productId: productId
    })
    await wishListItem.save()
    return res.status(201).json({ status: true, message: "Item added to wishlist successfully" });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}



//for delete from wish list

const RemoveFromWishList = async (req, res) => {
  try {
    const userId=req.session.user_id
    console.log("userId",userId)
    const {productId}=req.params
    console.log("productId",productId)
    const whishlist=await WishList.deleteOne({user:userId,productId:productId})
    console.log("whishlist",whishlist)
   
    if (whishlist.deletedCount === 0) {
      return res.status(404).json({ message: 'whishlist item not found or not removed' });
    }
    res.status(200).json({ status: true, message: 'whishlist item removed successfully' });


  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Internal server error' });

  }
}

module.exports = {
  loadWishlist,
  addToWishList,
  RemoveFromWishList
}