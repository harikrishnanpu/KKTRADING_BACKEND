import express from "express";
import Return from '../models/returnModal.js'
import Product from "../models/productModel.js";
import Damage from "../models/damageModal.js";
const returnRouter = express.Router();



returnRouter.get('/',async (req,res)=>{
    try{
        const allReturns = await Return.find()
        res.status(200).json(allReturns)
    }catch (error){
        res.status(500).json({message: "Error Fetching"})
    }
})

// Create new return
returnRouter.post('/create', async (req, res) => {
    const session = await Return.startSession();
    session.startTransaction();
    
    try {
      const { returnNo, selectedBillingNo, returnDate, customerName, customerAddress, products } = req.body;
  
      // Create new return
      const newReturn = new Return({
        returnNo,
        billingNo: selectedBillingNo,
        returnDate,
        customerName,
        customerAddress,
        products,
      });
  
      // Save the return
      const savedReturn = await newReturn.save({ session });
  
      // Update countInStock for each product
      for (const product of products) {
        const updatedProduct = await Product.findOne({ item_id: product.item_id }).session(session);
  
        if (!updatedProduct) {
          throw new Error(`Product with ID ${product.productId} not found`);
        }
  
        // Adjust countInStock (increase if product is returned)
        updatedProduct.countInStock += parseInt(product.quantity);
  
        await updatedProduct.save({ session });
      }
  
      // Commit the transaction
      await session.commitTransaction();
      session.endSession();
  
      res.json(savedReturn);
    } catch (error) {
      // Abort the transaction in case of an error
      await session.abortTransaction();
      session.endSession();
  
      res.status(500).json({ message: 'Error creating return or updating stock', error });
    }
  });



  // POST /api/damage/create
returnRouter.post('/damage/create', async (req, res) => {
    const { userName, damagedItems } = req.body;

    if (!userName || damagedItems.length === 0) {
      return res.status(400).json({ message: 'User name and damaged items are required.' });
    }
  
    try {
      // Save the damage bill
      const damage = new Damage({
        userName,
        damagedItems
      });
      await damage.save();

      console.log("saved")
  
      // Reduce the countInStock for each damaged item
      for (const damagedItem of damagedItems) {
        await Product.findOneAndUpdate(
          { item_id: damagedItem.item_id },
          { $inc: { countInStock: -parseInt(damagedItem.quantity) } },
          { new: true }
        );
      }
  
      res.status(201).json({ message: 'Damage bill created successfully and stock updated.' });

    } catch (error) {
      res.status(500).json({ message: 'Error creating damage bill or updating stock.', error });
    }
  });


  // GET /api/damage/getDamagedData
returnRouter.get('/damage/getDamagedData', async (req, res) => {
    try {
      const damagedData = await Damage.find(); // Fetches all damaged items from the DB
      res.json(damagedData);
    } catch (error) {
      res.status(500).json({ message: 'Error retrieving damaged data.', error });
    }
  });


  returnRouter.delete('/damage/delete/:id',async(req,res)=>{
    try{
      const damage = await Damage.findById(req.params.id)
  
      if (!damage) {
        return res.status(404).json({ message: 'Purchase not found' });
      }
  
      // Loop through each item in the purchase and update product stock
      for (let item of damage.damagedItems) {
        const product = await Product.findOne({item_id: item.item_id});
  
        if (product) {
          // Reduce the countInStock by the quantity in the purchase
          product.countInStock += parseInt(item.quantity)
  
          if (product.countInStock < 0) {
            product.countInStock = 0; // Ensure stock doesn't go below zero
          }
  
          await product.save();  // Save the updated product
        }
      }
  
      const deleteProduct = await damage.remove();
      res.send({ message: 'Product Deleted', bill: deleteProduct });
    }catch(error){
      res.status(500).send({ message: 'Error Occured' });
    }
  })


  returnRouter.delete('/return/delete/:id',async(req,res)=>{
    try{
      const ReturnEntry = await Return.findById(req.params.id)
  
      if (!ReturnEntry) {
        return res.status(404).json({ message: 'Purchase not found' });
      }
  
      // Loop through each item in the purchase and update product stock
      for (let item of ReturnEntry.products) {
        const product = await Product.findOne({item_id: item.item_id});
  
        if (product) {
          // Reduce the countInStock by the quantity in the purchase
          product.countInStock -= parseInt(item.quantity)
  
          if (product.countInStock < 0) {
            product.countInStock = 0; // Ensure stock doesn't go below zero
          }
  
          await product.save();  // Save the updated product
        }
      }
  
      const deleteProduct = await ReturnEntry.remove();
      res.send({ message: 'Product Deleted', ReturnBill: deleteProduct });
    }catch(error){
      res.status(500).send({ message: 'Error Occured' });
    }
  })
  

export default returnRouter;
