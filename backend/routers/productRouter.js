import express from 'express';
import expressAsyncHandler from 'express-async-handler';
import data from '../data.js';
import Product from '../models/productModel.js';
import User from '../models/userModel.js';
import { isAdmin, isAuth } from '../utils.js';
import asyncHandler from 'express-async-handler';
import Purchase from '../models/purchasemodals.js';
import Log from '../models/Logmodal.js';


const productRouter = express.Router();

productRouter.get(
  '/',
  expressAsyncHandler(async (req, res) => {
    const pageSize = 20;
    const page = Number(req.query.pageNumber) || 1;
    const name = req.query.name ? req.query.name.toUpperCase() : '';
    const category = req.query.category ? req.query.category.toUpperCase() : '';
    const seller = req.query.seller ? req.query.seller.toUpperCase() : '';
    const order = req.query.order ? req.query.order.toUpperCase() : '';
    const min = req.query.min && Number(req.query.min) !== 0 ? Number(req.query.min) : 0;
    const max = req.query.max && Number(req.query.max) !== 0 ? Number(req.query.max) : 0;
    const rating = req.query.rating && Number(req.query.rating) !== 0 ? Number(req.query.rating) : 0;

    const nameFilter = name ? { name: { $regex: name, $options: 'i' } } : {};
    const categoryFilter = category ? { category } : {};
    const sellerFilter = seller ? { seller } : {};
    const priceFilter = min && max ? { price: { $gte: min, $lte: max } } : {};
    const ratingFilter = rating ? { rating: { $gte: rating } } : {};
    const sortOrder =
      order === 'lowest'
        ? { price: 1 }
        : order === 'highest'
        ? { price: -1 }
        : order === 'toprated'
        ? { rating: -1 }
        : { _id: -1 };

    try {
      let products;
      let count = 0;

      // Check if name is a valid item_id
      if (name) {
        const itemById = await Product.findOne({ item_id: name });
        if (itemById) {
          products = [itemById];
          count = 1;
        }
      }

      // If name is not an item_id, use regular filters
      if (!products) {
        count = await Product.countDocuments({
          ...sellerFilter,
          ...nameFilter,
          ...categoryFilter,
          ...priceFilter,
          ...ratingFilter,
        });

        products = await Product.find({
          ...sellerFilter,
          ...nameFilter,
          ...categoryFilter,
          ...priceFilter,
          ...ratingFilter,
        })
          .populate('seller', 'seller.name seller.logo')
          .sort(sortOrder)
          .skip(pageSize * (page - 1))
          .limit(pageSize);
      }

      res.send({ products, page, totalProducts: count, pages: Math.ceil(count / pageSize) });
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  })
);



productRouter.get('/searchform/search', async (req, res) => {
  let searchQuery = req.query.q || '';
  searchQuery = (req.query.q || "").replace(/\s+/g, "").toUpperCase();

  try {
    let products;
    
    // Check if the search query matches the pattern for an item ID (starts with 'K' followed by numbers)
    const isItemId = /^K\d+$/.test(searchQuery);

    if (isItemId) {
      // Search for the product by item ID
      products = await Product.findOne({ item_id: searchQuery });
      if (products) {
        return res.status(200).json([products]); // Return the product as an array
      } else {
        return res.status(404).json({ message: 'Item not found' });
      }
    } else {
      // If not an item ID, perform a case-insensitive search by product name
      products = await Product.find({
        name: { $regex: searchQuery, $options: 'i' },
      }).limit(5); // Limit the number of suggestions
    }

    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching products' });
  }
});


// Route to get product by item ID
productRouter.get('/itemId/:itemId', async (req, res) => {
  try {
    const itemId = req.params.itemId.toUpperCase();

    // Search for the product by item_id (case-insensitive)
    let product = await Product.findOne({ item_id: itemId });

    // If no product is found with item_id, search by name
    if (!product) {
      product = await Product.findOne({ name: { $regex: itemId, $options: 'i' } });
    }

    // If still no product is found, return a 404 error
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // Return the found product
    res.status(200).json(product);
  } catch (error) {
    res.status(500).json({ message: 'Server Error' });
  }
});


productRouter.get('/search/itemId', async (req, res) => {
  try {
    const query = req.query.query.toUpperCase();
    // Regex to match item IDs starting with 'K' followed by 1 to 4 digits
    const isItemId = /^K\d{1,4}$/.test(query);

    let products;
    
    if (isItemId) {
      // If the query is an item ID, find the specific product
      products = await Product.find({ item_id: query }).limit(1);
    } else {
      // If the query is a name, perform a regex search
      const regex = new RegExp(query, 'i');  // Case-insensitive regex search
      products = await Product.find({ 
        $or: [
          { name: regex } 
        ] 
      }).limit(8); // Limit the number of suggestions
    }

    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Server Error', error });
  }
});


productRouter.get(
  '/categories',
  expressAsyncHandler(async (req, res) => {
    const categories = await Product.find().distinct('category');
    res.send(categories);
  })
);

productRouter.get(
  '/seed',
  expressAsyncHandler(async (req, res) => {
    // await Product.remove({});
    const seller = await User.findOne({ isSeller: true });
    if (seller) {
      const products = data.products.map((product) => ({
        ...product,
        seller: seller._id,
      }));
      const createdProducts = await Product.insertMany(products);
      res.send({ createdProducts });
    } else {
      res
        .status(500)
        .send({ message: 'No seller found. first run /api/users/seed' });
    }
  })
);

productRouter.get(
  '/:id',
  expressAsyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id).populate(
      'seller',
      'seller.name seller.logo seller.rating seller.numReviews'
    );
    if (product) {
      res.send(product);
    } else {
      res.status(404).send({ message: 'Product Not Found' });
    }
  })
);

productRouter.post(
  '/',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const product = new Product({
      name: 'Sample name ' + Date.now(),
      item_id: Date.now(),
      seller: req.user._id,
      image: '/images/',
      price: 0,
      category: 'Sample category',
      brand: 'Sample brand',
      countInStock: 0,
      rating: 0,
      numReviews: 0,
      description: 'Sample description',
    });
    const createdProduct = await product.save();
    res.send({ message: 'Product Created', product: createdProduct });
  })
);


// Update a product
productRouter.put('/get-item/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating product' });
  }
});

productRouter.put(
  '/:id',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    if (product) {
      product.name = req.body.name;
      product.price = req.body.price;
      product.image = req.body.image;
      product.category = req.body.category;
      product.brand = req.body.brand;
      product.countInStock = req.body.countInStock;
      product.description = req.body.description;
      product.item_id = req.body.itemId;
      const updatedProduct = await product.save();
      res.send({ message: 'Product Updated', product: updatedProduct });
    } else {
      res.status(404).send({ message: 'Product Not Found' });
    }
  })
);

productRouter.delete(
  '/:id',
  isAuth,
  isAdmin,
  expressAsyncHandler(async (req, res) => {
    const product = await Product.findById(req.params.id);
    if (product) {
      const deleteProduct = await product.remove();
      res.send({ message: 'Product Deleted', product: deleteProduct });
    } else {
      res.status(404).send({ message: 'Product Not Found' });
    }
  })
);

productRouter.post(
  '/:id/reviews',
  isAuth,
  expressAsyncHandler(async (req, res) => {
    const productId = req.params.id;
    const product = await Product.findById(productId);
    if (product) {
      if (product.reviews.find((x) => x.name === req.body.name)) {
        return res
          .status(400)
          .send({ message: 'You already submitted a review' });
      }
      const review = {
        name: req.body.name,
        rating: Number(req.body.rating),
        comment: req.body.comment,
      };
      product.reviews.push(review);
      product.numReviews = product.reviews.length;
      product.rating =
        product.reviews.reduce((a, c) => c.rating + a, 0) /
        product.reviews.length;
      const updatedProduct = await product.save();
      res.status(201).send({
        message: 'Review Created',
        review: updatedProduct.reviews[updatedProduct.reviews.length - 1],
      });
    } else {
      res.status(404).send({ message: 'Product Not Found' });
    }
  })
);


productRouter.post('/purchase', asyncHandler(async (req, res) => {


  const { sellerName, sellerId, invoiceNo, items } = req.body;

  try{

  for (const item of items) {
    const existingProduct = await Product.findOne({ item_id: item.itemId });

    if (existingProduct) {
      existingProduct.price = parseInt(item.price)
      existingProduct.countInStock += parseInt(item.quantity);
      await existingProduct.save();
    } else {
      const newProduct = new Product({
        name: item.name,
        item_id: item.itemId,
        brand: item.brand,
        category: item.category,
        countInStock: item.quantity,
        // Add other necessary fields here (e.g., description, price, etc.)
      });
      await newProduct.save();
      console.log("product saved")
    }
  }

  const purchase = new Purchase({
    sellerName,
    sellerId,
    invoiceNo,
    items,
  });

  const createdPurchase = await purchase.save();
  res.status(201).json(createdPurchase);
  }catch (error){
    console.log(error)
    res.status(500).json({message: "error occureed"})
  }

}));

productRouter.delete('/purchases/delete/:id',async(req,res)=>{
  try{
    const purchase = await Purchase.findById(req.params.id)

    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    // Loop through each item in the purchase and update product stock
    for (let item of purchase.items) {
      const product = await Product.findOne({item_id: item.itemId});

      if (product) {
        // Reduce the countInStock by the quantity in the purchase
        product.countInStock -= parseInt(item.quantity)

        if (product.countInStock < 0) {
          product.countInStock = 0; // Ensure stock doesn't go below zero
        }

        await product.save();  // Save the updated product
      }
    }

    const deleteProduct = await purchase.remove();
    res.send({ message: 'Product Deleted', product: deleteProduct });
  }catch(error){
    res.status(500).send({ message: 'Error Occured' });
  }
})


productRouter.get('/purchases/all',async (req,res) => {
  const allpurchases = await Purchase.find().sort({ createdAt: -1});
  if(allpurchases){
    res.status(200).json(allpurchases)
  }else{
    console.log("no bills")
    res.status(500).json({message: "No Purchase Bills Available"})
  }
});


// Route to fetch all low-stock products
productRouter.get('/all-items/low-stock', async (req, res) => {
  try {
    const products = await Product.find({ countInStock: { $lt: 10 } }).sort({ countInStock: 1 });
    res.json(products);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching low-stock products', error });
  }
});

// Route to fetch a limited number of low-stock products (e.g., for homepage)
productRouter.get('/items/low-stock-limited', async (req, res) => {
  try {
    const products = await Product.find({ countInStock: { $lt: 10 } })
      .sort({ countInStock: 1 })
      // .limit(3); // Limit to 3 products

    const outOfStockProducts = products.filter(product => product.countInStock == 0);
    const lowStockProducts = products.filter(product => product.countInStock > 0);

    // Combine them for the limited response
    const sortedLimitedProducts = [...outOfStockProducts, ...lowStockProducts].slice(0, 1); // Limit to 3
    res.json(sortedLimitedProducts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching low-stock products', error });
  }
});


productRouter.get('/low-stock/all', async (req, res) => {
  try {
    const products = await Product.find({ countInStock: { $lt: 10 } })
      .sort({ countInStock: 1 })
      // .limit(3); // Limit to 3 products

    const outOfStockProducts = products.filter(product => product.countInStock == 0);
    const lowStockProducts = products.filter(product => product.countInStock > -100);

    // Combine them for the limited response
    const sortedLimitedProducts = [...outOfStockProducts, ...lowStockProducts] // Limit to 3
    res.json(sortedLimitedProducts);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching low-stock products', error });
  }
});


export default productRouter;
