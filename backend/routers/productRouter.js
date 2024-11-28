import express from 'express';
import expressAsyncHandler from 'express-async-handler';
import data from '../data.js';
import Product from '../models/productModel.js';
import User from '../models/userModel.js';
import { isAdmin, isAuth } from '../utils.js';
import asyncHandler from 'express-async-handler';
import Purchase from '../models/purchasemodals.js';
import Log from '../models/Logmodal.js';
import Transportation from '../models/transportModal.js';
import SellerPayment from '../models/sellerPayments.js';
import TransportPayment from '../models/transportPayments.js';


const productRouter = express.Router();

productRouter.get(
  '/',
  expressAsyncHandler(async (req, res) => {
    const pageSize = 20;
    const page = Number(req.query.pageNumber) || 1;
    const searchQuery = req.query.name ? req.query.name.toUpperCase() : '';
    const category = req.query.category ? req.query.category.toUpperCase() : '';
    const order = req.query.order ? req.query.order.toUpperCase() : '';
    const min = req.query.min && Number(req.query.min) !== 0 ? Number(req.query.min) : 0;
    const max = req.query.max && Number(req.query.max) !== 0 ? Number(req.query.max) : 0;
    const rating = req.query.rating && Number(req.query.rating) !== 0 ? Number(req.query.rating) : 0;

    const categoryFilter = category ? { category } : {};
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
      let products = [];
      let count = 0;

      // Search for products based on `item_id`, `name`, or `seller`
      if (searchQuery) {
        const byItemId = await Product.findOne({ item_id: searchQuery });
        const bySeller = await Product.find({ seller: { $regex: searchQuery, $options: 'i' } });
        const byName = await Product.find({ name: { $regex: searchQuery, $options: 'i' } });

        // Prioritize item_id match; otherwise, include seller and name matches
        if (byItemId) {
          products = [byItemId];
          count = 1;
        } else if (bySeller.length > 0) {
          products = bySeller;
          count = bySeller.length;
        } else if (byName.length > 0) {
          products = byName;
          count = byName.length;
        }
      }

      // Apply filters if no specific matches found or for additional filtering
      if (products.length === 0) {
        count = await Product.countDocuments({
          ...categoryFilter,
          ...priceFilter,
          ...ratingFilter,
        });

        products = await Product.find({
          ...categoryFilter,
          ...priceFilter,
          ...ratingFilter,
        })
          .populate('seller', 'seller.name seller.logo')
          .sort(sortOrder)
          .skip(pageSize * (page - 1))
          .limit(pageSize);
      }

      // Paginate if there are multiple results
      const paginatedProducts = products.slice(pageSize * (page - 1), pageSize * page);

      res.send({
        products: paginatedProducts,
        page,
        totalProducts: count,
        pages: Math.ceil(count / pageSize),
      });
    } catch (error) {
      res.status(500).send({ message: error.message });
    }
  })
);




productRouter.get('/searchform/search', async (req, res) => {
  let searchQuery = (req.query.q || '').trim();
  const limit = parseFloat(req.query.limit) || 8;

  try {
    let products = [];

    // Check if the search query matches the pattern for an item ID (starts with 'K' followed by numbers)
    const isItemId = /^K\d+$/i.test(searchQuery);

    if (isItemId) {
      // Search for the product by item ID (exact match)
      const product = await Product.findOne({ item_id: searchQuery.toUpperCase() });
      if (product) {
        products.push(product);
      } else {
        return res.status(404).json({ message: 'No product found with the specified item ID' });
      }
    } else {
      // Split the search query into words and create a regex pattern for each
      const searchTerms = searchQuery.split(/\s+/).map(term => new RegExp(term, 'i'));

      // Find products where all search terms match in the `name` field
      products = await Product.find({
        $and: searchTerms.map(term => ({ name: { $regex: term } }))
      }).limit(limit);

      if (products.length === 0) {
        return res.status(404).json({ message: 'No products match your search query' });
      }
    }

    res.status(200).json(products);
  } catch (error) {
    res.status(500).json({ message: 'Error fetching products', error: error.message });
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


productRouter.get('/admin/categories', async (req, res) => {
  try {
    const categories = await Product.aggregate([
      {
        $group: {
          _id: '$category',
          count: { $sum: 1 },
        },
      },
    ]);

    res.json(
      categories.map((category) => ({
        name: category._id,
        count: category.count,
      }))
    );
  } catch (error) {
    console.error('Error fetching product categories:', error);
    res.status(500).json({ message: 'Error fetching product categories' });
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
  expressAsyncHandler(async (req, res) => {
    const product = new Product({
      name: 'Product Name',
      item_id: Date.now(),
      seller: 'Supplier',
      image: '/images/',
      price: 0,
      category: 'Category',
      brand: 'Brand',
      countInStock: 0,
      psRatio: 0,
      pUnit: 'BOX',
      sUnit: 'NOS',
      length: 0,
      breadth: 0,
      size: 'size',
      unit: 'unit',
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

productRouter.put('/update-stock/:id', async (req, res) => {
  const { countInStock } = req.body; // Extract countInStock from the request body

  try {
    // Check if countInStock is a valid number (float or integer)
    if (typeof countInStock !== 'number' || isNaN(countInStock)) {
      return res.status(400).json({ message: 'Invalid countInStock value' });
    }

    // Use $inc to add the countInStock value (can be a float)
    const product = await Product.findByIdAndUpdate(
      req.params.id,
      { $inc: { countInStock } },
      { new: true }
    );

    // Check if the product was found
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    res.json(product);
  } catch (error) {
    res.status(500).json({ message: 'Error updating product stock' });
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
      product.psRatio = req.body.psRatio;
      product.pUnit = req.body.pUnit;
      product.sUnit = req.body.sUnit;
      product.length = req.body.length;
      product.breadth = req.body.breadth;
      product.size = req.body.size;
      product.unit = req.body.unit;
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


productRouter.post(
  '/purchase',
  asyncHandler(async (req, res) => {
    const {
      sellerId,
      sellerName,
      items,
      invoiceNo,
      sellerAddress,
      sellerGst,
      billingDate,
      invoiceDate,
      totals,
      transportationDetails,
    } = req.body;

    let { purchaseId } = req.body;

        // **1. Check if Purchase with the same invoiceNo or purchaseId already exists**


    try {

      const existingPurchase = await Purchase.findOne({
        $or: [{ invoiceNo }, { purchaseId }],
      });

      if (existingPurchase) {
        // Find the latest invoiceNo that starts with 'KK' and is followed by digits
        const latestInvoice = await Purchase.findOne({ purchaseId: /^KP\d+$/ })
          .sort({ purchaseId: -1 })
          .collation({ locale: "en", numericOrdering: true })
  
        if (!latestInvoice) {
          // If no invoice exists, start with 'KK001'
          purchaseId = 'KP1';
        } else {
          const latestInvoiceNo = latestInvoice.purchaseId;
          const numberPart = parseInt(latestInvoiceNo.replace('KP', ''), 10);
          const nextNumber = numberPart + 1;
          purchaseId = `KP${nextNumber}`;
        }
      }


      // Handle product updates or creation
      for (const item of items) {
        const existingProduct = await Product.findOne({ item_id: item.itemId });

        // Adjust stock based on quantityInNumbers
        const quantityInNumbers = parseFloat(item.quantityInNumbers.toFixed(2));

        if (existingProduct) {
          existingProduct.countInStock += quantityInNumbers;
          existingProduct.price = parseFloat(item.totalPriceInNumbers).toFixed(2);
          Object.assign(existingProduct, item); // Update product fields
          await existingProduct.save();
        } else {
          const newProduct = new Product({
            item_id: item.itemId,
            ...item,
            countInStock: quantityInNumbers,
            price: parseFloat(item.totalPriceInNumbers).toFixed(2)
          });
          await newProduct.save();
        }
      }

      // Save purchase details
      const purchase = new Purchase({
        sellerId,
        sellerName,
        invoiceNo,
        items: items.map((item) => ({
          ...item,
        })),
        purchaseId,
        sellerAddress,
        sellerGst,
        billingDate,
        invoiceDate,
        totals,
      });

      await purchase.save();

      // Save transportation details
      if (transportationDetails) {
        const { logistic, local, other } = transportationDetails;

        // Logistic Transportation
        if (
          logistic &&
          logistic.transportCompanyName &&
          logistic.transportationCharges !== undefined
        ) {
          const logisticTransport = new Transportation({
            purchaseId: logistic.purchaseId,
            invoiceNo: logistic.invoiceNo,
            transportType: 'logistic',
            companyGst: logistic.companyGst,
            billId: logistic.billId,
            transportCompanyName: logistic.transportCompanyName,
            transportationCharges: parseFloat(
              logistic.transportationCharges
            ),
            remarks: logistic.remark,
          });

          await logisticTransport.save();

          // Create billing entry for TransportPayment
          const logisticBillingEntry = {
            amount: parseFloat(logistic.transportationCharges),
            date: logistic.billingDate || Date.now(),
            billId: logistic.billId,
            invoiceNo: logistic.invoiceNo,
          };

          // Find existing TransportPayment
          const logisticTransportPayment = await TransportPayment.findOne({
            transportName: logistic.transportCompanyName,
            transportType: 'logistic',
          });

          if (logisticTransportPayment) {
            await logisticTransportPayment.addBilling(logisticBillingEntry);
          } else {
            const newLogisticTransportPayment = new TransportPayment({
              transportName: logistic.transportCompanyName,
              transportType: 'logistic',
              payments: [],
              billings: [logisticBillingEntry],
              totalAmountBilled: parseFloat(logistic.transportationCharges),
              totalAmountPaid: 0,
              paymentRemaining: parseFloat(logistic.transportationCharges),
            });

            await newLogisticTransportPayment.save();
          }
        }

        // Local Transportation
        if (
          local &&
          local.transportCompanyName &&
          local.transportationCharges !== undefined
        ) {
          const localTransport = new Transportation({
            purchaseId: local.purchaseId,
            invoiceNo: local.invoiceNo,
            transportType: 'local',
            companyGst: local.companyGst,
            billId: local.billId,
            transportCompanyName: local.transportCompanyName,
            transportationCharges: parseFloat(local.transportationCharges),
            remarks: local.remark,
          });

          await localTransport.save();

          // Create billing entry for TransportPayment
          const localBillingEntry = {
            amount: parseFloat(local.transportationCharges),
            date: local.billingDate || Date.now(),
            billId: local.billId,
            invoiceNo: local.invoiceNo,
          };

          // Find existing TransportPayment
          const localTransportPayment = await TransportPayment.findOne({
            transportName: local.transportCompanyName,
            transportType: 'local',
          });

          if (localTransportPayment) {
            await localTransportPayment.addBilling(localBillingEntry);
          } else {
            const newLocalTransportPayment = new TransportPayment({
              transportName: local.transportCompanyName,
              transportType: 'local',
              payments: [],
              billings: [localBillingEntry],
              totalAmountBilled: parseFloat(local.transportationCharges),
              totalAmountPaid: 0,
              paymentRemaining: parseFloat(local.transportationCharges),
            });

            await newLocalTransportPayment.save();
          }
        }
      }

      // Add billing to SellerPayment
      const sellerPayment = await SellerPayment.findOne({ sellerId });

      const billingEntry = {
        amount: totals.totalPurchaseAmount,
        date: billingDate || Date.now(),
        purchaseId: purchaseId,
        invoiceNo: invoiceNo,
      };

      if (sellerPayment) {
        sellerPayment.billings.push(billingEntry);
        sellerPayment.totalAmountBilled = sellerPayment.billings.reduce(
          (sum, billing) => sum + billing.amount,
          0
        );
        sellerPayment.paymentRemaining =
          sellerPayment.totalAmountBilled - sellerPayment.totalAmountPaid;
        await sellerPayment.save();
      } else {
        const newSellerPayment = new SellerPayment({
          sellerId,
          sellerName,
          payments: [],
          billings: [billingEntry],
          totalAmountBilled: totals.totalPurchaseAmount,
          totalAmountPaid: 0,
          paymentRemaining: totals.totalPurchaseAmount,
        });

        await newSellerPayment.save();
      }

      res.json(purchaseId);
    } catch (error) {
      console.error('Error creating purchase:', error);
      res.status(500).json({ message: 'Error creating purchase', error });
    }
  })
);


productRouter.put(
  '/purchase/:purchaseId',
  asyncHandler(async (req, res) => {
    const { purchaseId } = req.params;
    const {
      sellerId,
      sellerName,
      invoiceNo,
      items,
      sellerAddress,
      sellerGst,
      billingDate,
      invoiceDate,
      totals,
      transportationDetails,
    } = req.body;

    try {
      const existingPurchase = await Purchase.findById(purchaseId);
      if (!existingPurchase) {
        return res.status(404).json({ message: 'Purchase not found' });
      }

      // Map old quantities for stock adjustment
      const oldItemMap = new Map();
      for (const item of existingPurchase.items) {
        oldItemMap.set(item.itemId, item.quantityInNumbers);
      }

      for (const item of items) {
        const product = await Product.findOne({ item_id: item.itemId });

        const oldQuantityInNumbers = oldItemMap.get(item.itemId) || 0;
        const newQuantityInNumbers = parseFloat(item.quantityInNumbers.toFixed(2));

        if (product) {
          product.countInStock += newQuantityInNumbers - oldQuantityInNumbers;
          product.price = parseFloat(item.totalPriceInNumbers).toFixed(2);
          Object.assign(product, item); // Update product fields
          await product.save();
        } else {
          const newProduct = new Product({
            item_id: item.itemId,
            ...item,
            countInStock: item.quantityInNumbers,
            price: parseFloat(item.totalPriceInNumbers).toFixed(2)
          });
          await newProduct.save();
        }
      }

      // Update purchase details
      existingPurchase.sellerId = sellerId;
      existingPurchase.sellerName = sellerName;
      existingPurchase.invoiceNo = invoiceNo;
      existingPurchase.items = items.map((item) => ({
        ...item,
      }));
      existingPurchase.sellerAddress = sellerAddress;
      existingPurchase.sellerGst = sellerGst;
      existingPurchase.billingDate = billingDate;
      existingPurchase.invoiceDate = invoiceDate;
      existingPurchase.totals = totals;

      await existingPurchase.save();

      // Update transportation details
      if (transportationDetails) {
        const { logistic, local, other } = transportationDetails;

        // Logistic Transportation
        if (
          logistic &&
          logistic.transportCompanyName &&
          logistic.transportationCharges !== undefined
        ) {
          const logisticTransport = await Transportation.findOneAndUpdate(
            { purchaseId, transportType: 'logistic' },
            {
              purchaseId: logistic.purchaseId,
              invoiceNo: logistic.invoiceNo,
              transportType: 'logistic',
              billId: logistic.billId,
              companyGst: logistic.companyGst,
              transportCompanyName: logistic.transportCompanyName,
              transportationCharges: parseFloat(
                logistic.transportationCharges
              ),
              remarks: logistic.remark,
            },
            { upsert: true, new: true }
          );

          // Update transport payments for logistic transport
          const logisticTransportPayment = await TransportPayment.findOne({
            transportName: logistic.transportCompanyName,
            transportType: 'logistic',
          });

          const logisticBillingEntry = {
            amount: parseFloat(logistic.transportationCharges),
            date: logistic.billingDate || Date.now(),
            billId: logistic.billId,
            invoiceNo: logistic.invoiceNo,
          };

          if (logisticTransportPayment) {
            // Find existing billing
            const billingIndex = logisticTransportPayment.billings.findIndex(
              (billing) => billing.billId === logistic.billId
            );

            if (billingIndex !== -1) {
              // Update existing billing
              logisticTransportPayment.billings[
                billingIndex
              ] = logisticBillingEntry;
            } else {
              // Add new billing
              logisticTransportPayment.billings.push(logisticBillingEntry);
            }

            // Recalculate totals
            logisticTransportPayment.totalAmountBilled =
              logisticTransportPayment.billings.reduce(
                (sum, billing) => sum + billing.amount,
                0
              );
            logisticTransportPayment.paymentRemaining =
              logisticTransportPayment.totalAmountBilled -
              logisticTransportPayment.totalAmountPaid;

            await logisticTransportPayment.save();
          } else {
            // Create new TransportPayment
            const newLogisticTransportPayment = new TransportPayment({
              transportName: logistic.transportCompanyName,
              transportType: 'logistic',
              payments: [],
              billings: [logisticBillingEntry],
              totalAmountBilled: parseFloat(logistic.transportationCharges),
              totalAmountPaid: 0,
              paymentRemaining: parseFloat(logistic.transportationCharges),
            });

            await newLogisticTransportPayment.save();
          }
        }

        // Local Transportation
        if (
          local &&
          local.transportCompanyName &&
          local.transportationCharges !== undefined
        ) {
          const localTransport = await Transportation.findOneAndUpdate(
            { purchaseId, transportType: 'local' },
            {
              purchaseId: local.purchaseId,
              invoiceNo: local.invoiceNo,
              transportType: 'local',
              billId: local.billId,
              companyGst: local.companyGst,
              transportCompanyName: local.transportCompanyName,
              transportationCharges: parseFloat(local.transportationCharges),
              remarks: local.remark,
            },
            { upsert: true, new: true }
          );

          // Update transport payments for local transport
          const localTransportPayment = await TransportPayment.findOne({
            transportName: local.transportCompanyName,
            transportType: 'local',
          });

          const localBillingEntry = {
            amount: parseFloat(local.transportationCharges),
            date: local.billingDate || Date.now(),
            billId: local.billId,
            invoiceNo: local.invoiceNo,
          };

          if (localTransportPayment) {
            // Find existing billing
            const billingIndex = localTransportPayment.billings.findIndex(
              (billing) => billing.billId === local.billId
            );

            if (billingIndex !== -1) {
              // Update existing billing
              localTransportPayment.billings[
                billingIndex
              ] = localBillingEntry;
            } else {
              // Add new billing
              localTransportPayment.billings.push(localBillingEntry);
            }

            // Recalculate totals
            localTransportPayment.totalAmountBilled =
              localTransportPayment.billings.reduce(
                (sum, billing) => sum + billing.amount,
                0
              );
            localTransportPayment.paymentRemaining =
              localTransportPayment.totalAmountBilled -
              localTransportPayment.totalAmountPaid;

            await localTransportPayment.save();
          } else {
            // Create new TransportPayment
            const newLocalTransportPayment = new TransportPayment({
              transportName: local.transportCompanyName,
              transportType: 'local',
              payments: [],
              billings: [localBillingEntry],
              totalAmountBilled: parseFloat(local.transportationCharges),
              totalAmountPaid: 0,
              paymentRemaining: parseFloat(local.transportationCharges),
            });

            await newLocalTransportPayment.save();
          }
        }

        // Other Expenses
      }

      // Update billing in SellerPayment
      const sellerPayment = await SellerPayment.findOne({ sellerId });
      if (sellerPayment) {
        const billingIndex = sellerPayment.billings.findIndex(
          (billing) => billing.purchaseId === purchaseId
        );

        if (billingIndex !== -1) {
          // Update existing billing
          sellerPayment.billings[billingIndex] = {
            amount: totals.totalPurchaseAmount,
            date: billingDate || Date.now(),
            purchaseId: purchaseId,
            invoiceNo: invoiceNo,
          };
        } else {
          // Add new billing if not found
          sellerPayment.billings.push({
            amount: totals.totalPurchaseAmount,
            date: billingDate || Date.now(),
            purchaseId: purchaseId,
            invoiceNo: invoiceNo,
          });
        }

        // Recalculate totals
        sellerPayment.totalAmountBilled = sellerPayment.billings.reduce(
          (sum, billing) => sum + billing.amount,
          0
        );
        sellerPayment.paymentRemaining =
          sellerPayment.totalAmountBilled - sellerPayment.totalAmountPaid;

        await sellerPayment.save();
      } else {
        // Create new SellerPayment document if none exists
        const newSellerPayment = new SellerPayment({
          sellerId,
          sellerName,
          payments: [],
          billings: [
            {
              amount: totals.totalPurchaseAmount,
              date: billingDate || Date.now(),
              purchaseId: purchaseId,
              invoiceNo: invoiceNo,
            },
          ],
          totalAmountBilled: totals.totalPurchaseAmount,
          totalAmountPaid: 0,
          paymentRemaining: totals.totalPurchaseAmount,
        });

        await newSellerPayment.save();
      }

      res.status(200).json({
        message: 'Purchase updated successfully',
        purchase: existingPurchase,
      });
    } catch (error) {
      console.log('Error updating purchase:', error);
      res.status(500).json({ message: 'Error updating purchase', error });
    }
  })
);







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
        product.countInStock -= parseFloat(item.quantity)

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


productRouter.get('/lastadded/id', async (req, res) => {
  try {
    // Fetch the invoice with the highest sequence number starting with 'K'
    const item = await Product.findOne({ item_id: /^K\d+$/ })
      .sort({ item_id: -1 })
      .collation({ locale: "en", numericOrdering: true });

    // Check if an invoice was found
    if (item) {
      res.json(item.item_id);
    } else {
      const newitem = await Product.find()
      .sort({ item_id: -1 })
      .collation({ locale: "en", numericOrdering: true });
      res.json(newitem.item_id);
    }
  } catch (error) {
    res.status(500).json({ message: 'Error fetching last order' });
  }
});




export default productRouter;
