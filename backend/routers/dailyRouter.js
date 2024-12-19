import express from 'express';
import { DailyTransaction, TransactionCategory } from '../models/dailyTransactionsModal.js';
import Billing from '../models/billingModal.js';
import PaymentsAccount from '../models/paymentsAccountModal.js';

const transactionRouter = express.Router();

// Middleware to protect routes (ensure user is authenticated)

// GET /api/daily/transactions?date=YYYY-MM-DD
transactionRouter.get('/transactions', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // Validate presence of both dates
    if (!fromDate || !toDate) {
      return res.status(400).json({ message: 'Both fromDate and toDate query parameters are required.' });
    }

    // Convert to Date objects
    const start = new Date(fromDate);
    const end = new Date(toDate);

    // Validate date formats
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Ensure fromDate is not after toDate
    if (start > end) {
      return res.status(400).json({ message: 'fromDate cannot be after toDate.' });
    }

    // Include the entire 'toDate' day
    end.setHours(23, 59, 59, 999);

    // Aggregation pipeline to fetch transactions and ensure only matching dates are retrieved
    const transactions = await DailyTransaction.aggregate([
      {
        $match: {
          date: { $gte: start, $lte: end },
        },
      },
      {
        $lookup: {
          from: 'transactioncategories', // Collection name for categories
          localField: 'category',       // Category field in DailyTransaction
          foreignField: 'name',         // Matching field in TransactionCategory
          as: 'categoryDetails',
        },
      },
      {
        $unwind: {
          path: '$categoryDetails',
          preserveNullAndEmptyArrays: true, // Allow transactions without matching categories
        },
      },
      {
        $project: {
          _id: 1,
          date: 1,
          amount: 1,
          type: 1,
          paymentFrom: 1,
          paymentTo: 1,
          method: 1,
          remark: 1,
          billId: 1,
          user: 1,
          // If categoryDetails is present, use its name; otherwise, use the original category string
          category: {
            $ifNull: ['$categoryDetails.name', '$category']
          },
        },
      },
      {
        $sort: { date: -1 }, // Sort by date descending
      },
    ]);

    // Filter transactions to ensure they strictly fall within the date range
    const filteredTransactions = transactions.filter(transaction => {
      const transactionDate = new Date(transaction.date);
      return transactionDate >= start && transactionDate <= end;
    });

    // Map transactions to include payment details explicitly
    const formattedTransactions = filteredTransactions.map(transaction => {
      return {
        _id: transaction._id,
        date: transaction.date,
        amount: transaction.amount,
        paymentFrom: transaction.paymentFrom,
        paymentTo: transaction.paymentTo,
        type: transaction.type,
        paymentDetails: transaction.type === 'in' ? transaction.paymentFrom : transaction.paymentTo,
        method: transaction.method,
        remark: transaction.remark,
        billId: transaction.billId,
        user: transaction.user,
        category: transaction.category,
      };
    });

    res.json(formattedTransactions);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ message: 'Internal Server Error while fetching transactions.' });
  }
});





// POST /api/daily/transactions
transactionRouter.post('/transactions', async (req, res) => {
  try {
    const {
      date,
      amount,
      paymentFrom,
      paymentTo,
      category,
      method, // This is the accountId of the primary payment method
      remark,
      billId,
      purchaseId,
      transportId,
      userId,
      type, // 'in', 'out', or 'transfer'
    } = req.body;

    // Validate required fields
    if (!date || !amount || !category || !method || !userId || !type) {
      return res.status(400).json({ message: 'Missing required fields.' });
    }

    // Validate transaction type
    const validTypes = ['in', 'out', 'transfer'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ message: 'Invalid transaction type.' });
    }

    // Additional validations based on transaction type
    if ((type === 'in' || type === 'transfer') && !paymentFrom) {
      return res.status(400).json({ message: 'paymentFrom is required for this transaction type.' });
    }

    if ((type === 'out' || type === 'transfer') && !paymentTo) {
      return res.status(400).json({ message: 'paymentTo is required for this transaction type.' });
    }

    // Parse and validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount.' });
    }

    // Fetch the payment account by method (accountId)
    const myAccount = await PaymentsAccount.findOne({ accountId: method });
    if (!myAccount) {
      return res.status(404).json({ message: 'Payment account not found.' });
    }

    let referenceId; 
    let referenceIdOut;
    let referenceIdIn;

    // Handle different transaction types
    if (type === 'in') {
      // Payment In
      referenceId = 'IN' + Date.now().toString();

      const accountPaymentEntry = {
        amount: parsedAmount,
        method: method,
        remark: `Payment from ${paymentFrom}`,
        referenceId: referenceId,
        submittedBy: userId,
        date: new Date(date),
      };

      myAccount.paymentsIn.push(accountPaymentEntry);
      myAccount.balanceAmount += parsedAmount; 
      await myAccount.save();

    } else if (type === 'out') {
      // Payment Out
      referenceId = 'OUT' + Date.now().toString();

      const accountPaymentEntry = {
        amount: parsedAmount,
        method: method,
        remark: `Payment to ${paymentTo}`,
        referenceId: referenceId,
        submittedBy: userId,
        date: new Date(date),
      };

      myAccount.paymentsOut.push(accountPaymentEntry);
      myAccount.balanceAmount -= parsedAmount; 
      // Check for negative balance if needed
      await myAccount.save();

    } else if (type === 'transfer') {
      // Transfer
      // paymentFrom and paymentTo are accountIds
      const fromAccount = await PaymentsAccount.findOne({ accountId: paymentFrom });
      const toAccount = await PaymentsAccount.findOne({ accountId: paymentTo });

      if (!fromAccount || !toAccount) {
        return res.status(404).json({ message: 'One or both payment accounts not found.' });
      }

      if (fromAccount.balanceAmount < parsedAmount) {
        return res.status(400).json({ message: 'Insufficient funds in the source account.' });
      }

      referenceIdOut = 'OUT' + Date.now().toString();
      referenceIdIn = 'IN' + Date.now().toString();

      const transferOutEntry = {
        amount: parsedAmount,
        method: method,
        remark: `Transferred to ${paymentTo}`,
        referenceId: referenceIdOut,
        submittedBy: userId,
        date: new Date(date),
      };

      const transferInEntry = {
        amount: parsedAmount,
        method: method,
        remark: `Transferred from ${paymentFrom}`,
        referenceId: referenceIdIn,
        submittedBy: userId,
        date: new Date(date),
      };

      fromAccount.paymentsOut.push(transferOutEntry);
      fromAccount.balanceAmount -= parsedAmount;

      toAccount.paymentsIn.push(transferInEntry);
      toAccount.balanceAmount += parsedAmount;

      await fromAccount.save();
      await toAccount.save();
    }

    // Create and save the new DailyTransaction
    const newTransactionData = {
      date,
      amount: parsedAmount,
      paymentFrom: paymentFrom || '',
      paymentTo: paymentTo || '',
      category,
      method,
      remark: remark || '',
      billId: billId || null,
      purchaseId: purchaseId || null,
      transportId: transportId || null,
      user: userId,
      type,
    };

    // Add reference IDs to the transaction document if applicable
    if (type === 'in' || type === 'out') {
      newTransactionData.referenceId = referenceId;
    } else if (type === 'transfer') {
      newTransactionData.referenceIdOut = referenceIdOut;
      newTransactionData.referenceIdIn = referenceIdIn;
    }

    const newTransaction = new DailyTransaction(newTransactionData);
    const savedTransaction = await newTransaction.save();

    res.status(201).json(savedTransaction);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ message: 'Server Error while creating transaction.' });
  }
});




// DELETE /api/daily/transactions/:id
transactionRouter.delete('/transactions/:id', async (req, res) => {
  try {
    const transactionId = req.params.id;

    // Find the transaction
    const transaction = await DailyTransaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({ message: 'Transaction not found.' });
    }

    const { type, amount, method, paymentFrom, paymentTo, user, date, remark, referenceId, referenceIdOut, referenceIdIn } = transaction;
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({ message: 'Invalid transaction amount.' });
    }

    // Helper function to remove an entry from payments arrays
    const removePaymentEntry = (paymentsArray, refId) => {
      const index = paymentsArray.findIndex((p) => p.referenceId === refId);
      if (index !== -1) {
        paymentsArray.splice(index, 1);
        return true;
      }
      return false;
    };

    // For single-account transactions (in/out), the main account is identified by `method`.
    // For transfers, we will need both `paymentFrom` and `paymentTo` accounts.

    if (type === 'in') {
      // Payment In: We added an entry in `myAccount.paymentsIn`
      // Find the account by `method`
      const myAccount = await PaymentsAccount.findOne({ accountId: method });
      if (!myAccount) {
        return res.status(404).json({ message: 'Linked payment account not found for this transaction.' });
      }

      // Remove the entry from paymentsIn using referenceId
      if (!removePaymentEntry(myAccount.paymentsIn, referenceId)) {
        return res.status(404).json({ message: 'Associated payment entry not found in account.' });
      }

      // Revert the balance
      myAccount.balanceAmount -= parsedAmount;
      await myAccount.save();
    } else if (type === 'out') {
      // Payment Out: We added an entry in `myAccount.paymentsOut`
      const myAccount = await PaymentsAccount.findOne({ accountId: method });
      if (!myAccount) {
        return res.status(404).json({ message: 'Linked payment account not found for this transaction.' });
      }

      // Remove the entry from paymentsOut
      if (!removePaymentEntry(myAccount.paymentsOut, referenceId)) {
        return res.status(404).json({ message: 'Associated payment entry not found in account.' });
      }

      // Revert the balance
      myAccount.balanceAmount += parsedAmount;
      await myAccount.save();
    } else if (type === 'transfer') {
      // Transfer: We have `referenceIdOut` and `referenceIdIn`
      // Find both fromAccount and toAccount
      const fromAccount = await PaymentsAccount.findOne({ accountId: paymentFrom });
      const toAccount = await PaymentsAccount.findOne({ accountId: paymentTo });

      if (!fromAccount || !toAccount) {
        return res.status(404).json({ message: 'One or both accounts involved in this transfer no longer exist.' });
      }

      // Remove the corresponding entries:
      // fromAccount.paymentsOut should have referenceIdOut
      if (!removePaymentEntry(fromAccount.paymentsOut, referenceIdOut)) {
        return res.status(404).json({ message: 'Associated outgoing payment entry not found in fromAccount.' });
      }

      // toAccount.paymentsIn should have referenceIdIn
      if (!removePaymentEntry(toAccount.paymentsIn, referenceIdIn)) {
        return res.status(404).json({ message: 'Associated incoming payment entry not found in toAccount.' });
      }

      // Revert balances
      fromAccount.balanceAmount += parsedAmount;
      toAccount.balanceAmount -= parsedAmount;

      await fromAccount.save();
      await toAccount.save();
    } else {
      return res.status(400).json({ message: 'Invalid transaction type.' });
    }

    // Finally, delete the transaction itself
    await DailyTransaction.findByIdAndDelete(transactionId);

    res.json({ message: 'Transaction deleted successfully.' });
  } catch (error) {
    console.error('Error deleting transaction:', error);
    res.status(500).json({ message: 'Server error while deleting transaction.' });
  }
});



// GET /api/daily/transactions/categories
transactionRouter.get('/transactions/categories', async (req, res) => {
  try {
    const categories = await TransactionCategory.find();
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// POST /api/daily/transactions/categories
transactionRouter.post('/transactions/categories', async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) {
      return res.status(400).json({ message: 'Category name is required.' });
    }
    const existingCategory = await TransactionCategory.findOne({ name });
    if (existingCategory) {
      return res.status(400).json({ message: 'Category already exists.' });
    }
    const newCategory = new TransactionCategory({ name });
    const savedCategory = await newCategory.save();
    res.status(201).json(savedCategory);
  } catch (error) {
    console.error('Error creating category:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});

// Similarly, ensure /api/daily/billing routes are implemented
// Example: GET /api/daily/billing?date=YYYY-MM-DD
transactionRouter.get('/billing', async (req, res) => {
  try {
    const { date } = req.query;
    const start = new Date(date);
    const end = new Date(date);
    end.setDate(end.getDate() + 1);

    const billings = await Billing.find({
      invoiceDate: { $gte: start, $lt: end },
      user: req.body.userId,
    }).populate('otherExpenses'); // Assuming otherExpenses is a reference

    res.json(billings);
  } catch (error) {
    console.error('Error fetching billings:', error);
    res.status(500).json({ message: 'Server Error' });
  }
});


transactionRouter.get('/allbill/payments', async (req, res) => {
  try {
    const { fromDate, toDate } = req.query;

    // Validate presence of both dates
    if (!fromDate || !toDate) {
      return res.status(400).json({ message: 'Both fromDate and toDate are required.' });
    }

    // Convert to Date objects
    const start = new Date(fromDate);
    const end = new Date(toDate);

    // Validate date formats
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({ message: 'Invalid date format. Use YYYY-MM-DD.' });
    }

    // Ensure fromDate is not after toDate
    if (start > end) {
      return res.status(400).json({ message: 'fromDate cannot be after toDate.' });
    }

    // Adjust end date to include the entire day
    end.setHours(23, 59, 59, 999);

    // Fetch all bills
    const billings = await Billing.find()
      .populate('products') // If products are references
      .populate('deliveries') // If deliveries are references
      .lean(); // Use lean() for better performance if you don't need Mongoose document methods

    // Initialize arrays for payments and other expenses
    const payments = [];
    const otherExpenses = [];

    // Iterate through billings to collect payments and other expenses within date range
    billings.forEach(billing => {
      (billing.payments || []).forEach(payment => {
        const paymentDate = new Date(payment.date);
        if (paymentDate >= start && paymentDate <= end) {
          payments.push({
            billingId: billing._id,
            amount: payment.amount,
            paymentFrom: billing.customerName,
            method: payment.method,
            date: payment.date,
            remark: payment.remark,
          });
        }
      });

      (billing.otherExpenses || []).forEach(expense => {
        const expenseDate = new Date(expense.date);
        if (expenseDate >= start && expenseDate <= end) {
          otherExpenses.push({
            billingId: billing._id,
            amount: expense.amount,
            paymentFrom: billing.customerName,
            remark: expense.remark,
            date: expense.date,
          });
        }
      });
    });

    // Format the response
    const formattedResponse = {
      billings: billings.filter(billing => {
        const billingDate = new Date(billing.invoiceDate);
        return billingDate >= start && billingDate <= end;
      }),
      payments, // Payments filtered by date range
      otherExpenses, // Other expenses filtered by date range
    };

    res.json(formattedResponse);
  } catch (error) {
    console.error('Error fetching billings:', error);
    res.status(500).json({ message: 'Server Error while fetching billings and payments.' });
  }
});



transactionRouter.post('/trans/transfer', async (req, res) => {
  try {
    const {
      date,
      amount,
      paymentFrom,
      paymentTo,
      category,
      method,
      remark,
      userId,
    } = req.body;

    // Validate required fields
    if (!date || !amount || !paymentFrom || !paymentTo || !category || !method || !userId) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // Validate paymentFrom and paymentTo
    if (paymentFrom === paymentTo) {
      return res.status(400).json({ message: 'paymentFrom and paymentTo cannot be the same.' });
    }

    // Parse and validate amount
    const parsedPaymentAmount = parseFloat(amount);
    if (isNaN(parsedPaymentAmount) || parsedPaymentAmount <= 0) {
      return res.status(400).json({ message: 'Invalid amount.' });
    }

    // Fetch payment accounts
    const fromAccount = await PaymentsAccount.findOne({ accountId: paymentFrom });
    const toAccount = await PaymentsAccount.findOne({ accountId: paymentTo });

    if (!fromAccount || !toAccount) {
      return res.status(404).json({ message: 'One or both payment accounts not found.' });
    }

    // Check if the `fromAccount` has sufficient balance
    // if (fromAccount.balanceAmount < parsedPaymentAmount) {
    //   return res.status(400).json({ message: 'Insufficient funds in the source account.' });
    // }

    // Generate unique reference IDs for each payment entry
    const referenceIdOut = 'OUT' + Date.now().toString();
    const referenceIdIn = 'IN' + Date.now().toString();

    // Prepare payment entries with reference IDs
    const accountFromPaymentEntry = {
      amount: parsedPaymentAmount,
      method,
      remark: `Transferred to ${paymentTo}`,
      referenceId: referenceIdOut,
      submittedBy: userId,
      date: new Date(date),
    };

    const accountToPaymentEntry = {
      amount: parsedPaymentAmount,
      method,
      remark: `Transferred from ${paymentFrom}`,
      referenceId: referenceIdIn,
      submittedBy: userId,
      date: new Date(date),
    };

    // Update accounts
    fromAccount.paymentsOut.push(accountFromPaymentEntry);
    toAccount.paymentsIn.push(accountToPaymentEntry);

    // Update account balances
    fromAccount.balanceAmount -= parsedPaymentAmount;
    toAccount.balanceAmount += parsedPaymentAmount;

    // Save accounts
    await fromAccount.save();
    await toAccount.save();

    // Create 'transfer' transaction with reference IDs
    const transferTransaction = new DailyTransaction({
      date,
      amount: parsedPaymentAmount,
      paymentFrom,
      paymentTo,
      category,
      method,
      remark,
      type: 'transfer',
      user: userId,
      referenceIdOut: referenceIdOut,
      referenceIdIn: referenceIdIn,
    });

    // Save the transaction
    await transferTransaction.save();

    res.status(201).json({ message: 'Transfer successful.', transaction: transferTransaction });
  } catch (error) {
    console.error('Error in transferring funds:', error);
    res.status(500).json({ message: 'Error in transferring funds.' });
  }
});



transactionRouter.delete('/acc/:id/delete', async (req, res) => {
  const { id } = req.params; // paymentId
  try {
    // Find the account that contains this payment in either paymentsIn or paymentsOut.
    // We'll search for a payment that matches this id. Assuming that 'referenceId'
    // or '_id' of the sub-document is what identifies the payment. 
    // If you're using _id for each payment sub-document, you can use that:
    
    const account = await PaymentsAccount.findOne({
      $or: [
        { 'paymentsIn._id': id },
        { 'paymentsOut._id': id }
      ]
    });

    if (!account) {
      return res.status(404).json({ message: 'Payment not found' });
    }

    // Remove the payment from paymentsIn or paymentsOut
    let removed = false;
    // Try removing from paymentsIn
    account.paymentsIn = account.paymentsIn.filter(payment => {
      if (payment._id.toString() === id) {
        removed = true;
        return false;
      }
      return true;
    });

    // If not removed from paymentsIn, try paymentsOut
    if (!removed) {
      account.paymentsOut = account.paymentsOut.filter(payment => payment._id.toString() !== id);
    }

    // Save the updated account (this will trigger the pre-save middleware 
    // that recalculates the balance).
    await account.save();

    res.json({ message: 'Payment deleted successfully', account });
  } catch (error) {
    console.error('Error deleting payment:', error);
    res.status(500).json({ message: 'Internal Server Error' });
  }
});




export default transactionRouter;
