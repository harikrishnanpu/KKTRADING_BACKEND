// controllers/transportPaymentController.js
import express from 'express';
import TransportPayment from '../models/transportPayments.js';
import PaymentsAccount from '../models/paymentsAccountModal.js';
import mongoose from 'mongoose';
import Transportation from '../models/transportModal.js';


const transportPaymentsRouter = express.Router();

// Get transport suggestions based on partial transport name
transportPaymentsRouter.get('/suggestions', async (req, res) => {
  try {
    const search = req.query.search || '';
    const regex = new RegExp(search, 'i'); // case-insensitive search
    const transports = await TransportPayment.find({ transportName: regex }).select('transportName');
    res.json(transports);
  } catch (error) {
    console.error('Error fetching transport suggestions:', error);
    res.status(500).json({ message: 'Error fetching transport suggestions' });
  }
});

// Get transport details by ID
transportPaymentsRouter.get('/get/:id', async (req, res) => {
  try {
    const transport = await TransportPayment.findById(req.params.id);
    if (!transport) {
      return res.status(404).json({ message: 'Transport not found' });
    }
    res.json(transport);
  } catch (error) {
    console.error('Error fetching transport details:', error);
    res.status(500).json({ message: 'Error fetching transport details' });
  }
});


transportPaymentsRouter.get('/get-transport/:id', async (req, res) => {
  try {
    const transport = await TransportPayment.findById(req.params.id);
    if (!transport) {
      return res.status(404).json({ message: 'Transport not found' });
    }
    res.json(transport);
  } catch (error) {
    console.error('Error fetching transport details:', error);
    res.status(500).json({ message: 'Error fetching transport details' });
  }
});

// Add a payment to a transport
transportPaymentsRouter.post('/add-payments/:id', async (req, res) => {
  const paymentReferenceId = 'PAY' + Date.now().toString();
  try {
    const transport = await TransportPayment.findById(req.params.id);
    if (!transport) {
      return res.status(404).json({ message: 'Transport not found' });
    }

    const { amount, method, date, remark, billId , userId, transportName, transportId } = req.body;

    if (!amount || !method || !date) {
      return res.status(400).json({ message: 'Amount, method, and date are required' });
    }

    const payment = {
      amount,
      method,
      date,
      billId,
      remark,
      referenceId: paymentReferenceId,
      submittedBy: userId ? userId : 'Unknown', // Assuming you have user authentication
    };


    const accountPaymentEntry = {
      amount: amount,
      method: method,
      remark: `Transportation Payment to ${transportName} - ${transportId}`,
      referenceId: paymentReferenceId,
      submittedBy: req.body.userId,
    };
  
    try {
      const account = await PaymentsAccount.findOne({ accountId: method });
    
      if (!account) {
        console.log(`No account found for accountId: ${method}`);
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'Payment account not found' });
      }
    
      account.paymentsOut.push(accountPaymentEntry);
    
      await account.save();

    }catch(error){
      console.error('Error processing payment:', error);
      return res.status(500).json({ message: 'Error processing payment', error });
    }

    await transport.addPayment(payment);
    res.json({ message: 'Payment added successfully' });
  } catch (error) {
    console.error('Error adding payment:', error);
    res.status(500).json({ message: 'Error adding payment' });
  }
});

// Add a billing to a transport
transportPaymentsRouter.post('/add-billing/:id', async (req, res) => {
  try {
    const transport = await TransportPayment.findById(req.params.id);
    if (!transport) {
      return res.status(404).json({ message: 'Transport not found' });
    }

    const { amount, date, transportId, invoiceNo } = req.body;

    if (!amount || !transportId || !invoiceNo) {
      return res.status(400).json({ message: 'Amount, transportId, and invoiceNo are required' });
    }

    const billing = {
      amount,
      date,
      transportId,
      invoiceNo,
    };

    await transport.addBilling(billing);
    res.json({ message: 'Billing added successfully' });
  } catch (error) {
    console.error('Error adding billing:', error);
    res.status(500).json({ message: 'Error adding billing' });
  }
});



// GET route to fetch transport payments for a specific date
// transportPaymentsRouter.js

transportPaymentsRouter.get('/daily/payments', async (req, res) => {
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

    // Aggregation pipeline to fetch transport payments within the date range
    const transports = await TransportPayment.aggregate([
      { $unwind: '$payments' }, // Unwind payments array
      {
        $match: {
          'payments.date': { $gte: start, $lte: end }, // Filter by date range
        },
      },
      {
        $group: {
          _id: '$transportId', // Group by transportId
          transportName: { $first: '$transportName' },
          payments: {
            $push: {
              amount: '$payments.amount',
              date: '$payments.date',
              method: '$payments.method',
              submittedBy: '$payments.submittedBy',
              remark: '$payments.remark',
            },
          },
        },
      },
      {
        $sort: { transportName: 1 }, // Sort by transportName alphabetically
      },
    ]);

    // Send the response
    res.json(transports);
  } catch (error) {
    console.error('Error fetching transport payments:', error);
    res.status(500).json({ message: 'Internal Server Error while fetching transport payments.' });
  }
});


// Get All Transport Payments
transportPaymentsRouter.get('/all', async (req, res) => {
  try {
    const payments = await TransportPayment.find({});
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});


transportPaymentsRouter.get('/name/:name', async (req, res) => {
  try{
    const transports = await TransportPayment.findOne({ transportName: new RegExp(req.params.name, 'i') });
    res.json(transports);
  }catch (err) {
    res.status(404).json({ message: 'Transport not found.' });
  }
})




// PUT /:id/update// PUT /:id/update
transportPaymentsRouter.put('/:id/update', async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const transportPaymentId = req.params.id;
    const {
      transportName,
      transportType,
      transportGst,
      billings,
      payments, // Array of payment objects
    } = req.body;

    // 1. Fetch the existing TransportPayment document
    const existingTransportPayment = await TransportPayment.findById(transportPaymentId).session(session);

    if (!existingTransportPayment) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({ message: 'Transport payment not found.' });
    }

    // 2. Store old payments for comparison (keyed by billId)
    const oldPaymentsMap = new Map(
      existingTransportPayment.payments.map((payment) => [payment.billId, payment])
    );

    // 3. Update TransportPayment fields
    if (transportName !== undefined) existingTransportPayment.transportName = transportName;
    if (transportType !== undefined) existingTransportPayment.transportType = transportType;
    if (transportGst !== undefined) existingTransportPayment.transportGst = transportGst;
    if (billings !== undefined) existingTransportPayment.billings = billings;
    if (payments !== undefined) existingTransportPayment.payments = payments;

    // 4. Save the updated TransportPayment (triggers pre-save middleware)
    const updatedTransportPayment = await existingTransportPayment.save({ session });

    // 5. Prepare new payments map (keyed by billId)
    const newPaymentsMap = new Map(
      updatedTransportPayment.payments.map((payment) => [payment.billId, payment])
    );

    // 6. Identify payments to add, update, or remove
    const paymentsToAdd = [];
    const paymentsToUpdate = [];
    const paymentsToRemove = [];

    // Determine added and updated payments
    for (const [billId, newPayment] of newPaymentsMap.entries()) {
      const oldPayment = oldPaymentsMap.get(billId);
      if (!oldPayment) {
        // New payment
        paymentsToAdd.push(newPayment);
      } else {
        // Existing payment, check if any field has changed
        const isChanged =
          oldPayment.amount !== newPayment.amount ||
          oldPayment.method !== newPayment.method ||
          oldPayment.remark !== newPayment.remark ||
          oldPayment.submittedBy !== newPayment.submittedBy ||
          new Date(oldPayment.date).toISOString() !== new Date(newPayment.date).toISOString();

        if (isChanged) {
          paymentsToUpdate.push({ oldPayment, newPayment });
        }
      }
    }

    // Determine removed payments
    for (const [billId, oldPayment] of oldPaymentsMap.entries()) {
      if (!newPaymentsMap.has(billId)) {
        paymentsToRemove.push(oldPayment);
      }
    }

    // Helper function to find PaymentsAccount by accountId
    const findPaymentsAccountById = async (accountId) => {
      const account = await PaymentsAccount.findOne({ accountId }).session(session);
      if (!account) {
        throw new Error(`PaymentsAccount with accountId ${accountId} not found.`);
      }
      return account;
    };

    // 7. Handle Added Payments
    for (const payment of paymentsToAdd) {
      const { method: accountId, billId, amount, method, remark, submittedBy, date } = payment;

      // Find the PaymentsAccount
      const paymentsAccount = await findPaymentsAccountById(accountId);

      // Check if the payment already exists to prevent duplicates
      const existingPayment = paymentsAccount.paymentsOut.find(
        (pa) => pa.referenceId === billId
      );
      if (existingPayment) {
        throw new Error(
          `Payment with billId ${billId} already exists in PaymentsAccount ${accountId}.`
        );
      }

      // Add the payment to paymentsOut
      paymentsAccount.paymentsOut.push({
        amount,
        method,
        remark,
        referenceId: billId,
        submittedBy,
        date,
      });

      await paymentsAccount.save({ session });
    }

    // 8. Handle Updated Payments
    for (const { oldPayment, newPayment } of paymentsToUpdate) {
      const {
        billId: oldBillId,
        method: oldAccountId,
      } = oldPayment;

      const {
        billId: newBillId,
        method: newAccountId,
        amount: newAmount,
        method: newMethod,
        remark: newRemark,
        submittedBy: newSubmittedBy,
        date: newDate,
      } = newPayment;

      if (oldAccountId !== newAccountId) {
        // Method (accountId) has changed: Remove from old account and add to new account

        // Remove from old PaymentsAccount
        const oldAccount = await findPaymentsAccountById(oldAccountId);
        const paymentIndexOld = oldAccount.paymentsOut.findIndex(
          (pa) => pa.referenceId === oldBillId
        );

        if (paymentIndexOld === -1) {
          throw new Error(
            `Payment with billId ${oldBillId} not found in PaymentsAccount ${oldAccountId}.`
          );
        }

        oldAccount.paymentsOut.splice(paymentIndexOld, 1);
        await oldAccount.save({ session });

        // Add to new PaymentsAccount
        const newAccount = await findPaymentsAccountById(newAccountId);

        // Check if the payment already exists in the new account to prevent duplicates
        const existingPayment = newAccount.paymentsOut.find(
          (pa) => pa.referenceId === newBillId
        );
        if (existingPayment) {
          throw new Error(
            `Payment with billId ${newBillId} already exists in PaymentsAccount ${newAccountId}.`
          );
        }

        newAccount.paymentsOut.push({
          amount: newAmount,
          method: newMethod,
          remark: newRemark,
          referenceId: newBillId,
          submittedBy: newSubmittedBy,
          date: newDate,
        });
        await newAccount.save({ session });
      } else {
        // Method (accountId) hasn't changed: Update the payment within the same account
        const account = await findPaymentsAccountById(newAccountId);

        const paymentIndex = account.paymentsOut.findIndex(
          (pa) => pa.referenceId === newBillId
        );

        if (paymentIndex === -1) {
          throw new Error(
            `Payment with billId ${newBillId} not found in PaymentsAccount ${newAccountId}.`
          );
        }

        // Update the payment fields
        account.paymentsOut[paymentIndex].amount = newAmount;
        account.paymentsOut[paymentIndex].method = newMethod;
        account.paymentsOut[paymentIndex].remark = newRemark;
        account.paymentsOut[paymentIndex].submittedBy = newSubmittedBy;
        account.paymentsOut[paymentIndex].date = newDate;

        await account.save({ session });
      }
    }

    // 9. Handle Removed Payments
    for (const oldPayment of paymentsToRemove) {
      const { billId, method: accountId } = oldPayment;

      // Find the PaymentsAccount
      const paymentsAccount = await findPaymentsAccountById(accountId);

      // Remove the payment from paymentsOut
      const paymentIndex = paymentsAccount.paymentsOut.findIndex(
        (pa) => pa.referenceId === billId
      );

      if (paymentIndex === -1) {
        throw new Error(
          `Payment with billId ${billId} not found in PaymentsAccount ${accountId}.`
        );
      }

      paymentsAccount.paymentsOut.splice(paymentIndex, 1);
      await paymentsAccount.save({ session });
    }

    // 10. Optionally, handle updates to related Transportation documents here
    // For example, if Transportation documents reference the payments being updated,
    // ensure they are also updated accordingly.

    // 11. Commit the transaction
    await session.commitTransaction();
    session.endSession();

    // 12. Return the updated TransportPayment document
    res.json(updatedTransportPayment);
  } catch (error) {
    // Abort the transaction in case of error
    await session.abortTransaction();
    session.endSession();

    console.error('Error updating transport payment:', error);
    res.status(400).json({ message: error.message });
  }
});



// Delete Transport Payment
transportPaymentsRouter.delete('/:id/delete', async (req, res) => {
  try {
    const payment = await TransportPayment.findById(req.params.id);
    if (payment) {
      await payment.remove();
      res.json({ message: 'Transport payment record deleted successfully.' });
    } else {
      res.status(404).json({ message: 'Transport payment not found.' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});



transportPaymentsRouter.post('/create', async (req, res) => {
  try {
    const {
      transportName,
      transportType,
      transportGst,
      billings,
      payments,
      userId,
    } = req.body;

    // Basic validation
    if (!transportName || !transportType) {
      return res
        .status(400)
        .json({ message: 'Transport name and type are required.' });
    }

    // Find existing TransportPayment or create a new one
    let transportPayment = await TransportPayment.findOne({
      transportName: transportName.trim(),
      transportType: transportType.trim(),
    });

    if (!transportPayment) {
      transportPayment = new TransportPayment({
        transportName: transportName.trim(),
        transportType: transportType.trim(),
        transportGst: transportGst.trim(),
        billings: [],
        payments: [],
        userId: userId,
      });
    }

    // Add billings if provided
    if (billings && billings.length > 0) {
      for (const billing of billings) {
        const trimmedBillId = billing.billId.trim();

        // Avoid duplicate billings based on billId
        if (!transportPayment.billings.some((b) => b.billId === trimmedBillId)) {
          transportPayment.billings.push({
            billId: trimmedBillId,
            invoiceNo: billing.invoiceNo.trim(),
            amount: parseFloat(billing.amount),
            date: billing.date ? new Date(billing.date) : new Date(),
          });
        }

        // Ensure corresponding Transportation document exists
        let transportation = await Transportation.findOne({
          billId: trimmedBillId,
        });

        if (!transportation) {
          // Create new Transportation record
          transportation = new Transportation({
            invoiceNo: billing.invoiceNo.trim(),
            billId: billing.billId.trim(),
            transportCompanyName: transportName.trim(),
            transportationCharges: parseFloat(billing.amount),
            purchaseId: trimmedBillId,
            companyGst: transportGst.trim(),
            transportType: transportType.trim(),
            remarks: billing.remarks ? billing.remarks.trim() : '',
            otherDetails: billing.otherDetails ? billing.otherDetails.trim() : '',
          });
          await transportation.save();
        } else {
          // Update existing Transportation record if necessary
          let updated = false;

          if (transportation.invoiceNo !== billing.invoiceNo.trim()) {
            transportation.invoiceNo = billing.invoiceNo.trim();
            updated = true;
          }
          if (transportation.transportCompanyName !== transportName.trim()) {
            transportation.transportCompanyName = transportName.trim();
            updated = true;
          }
          if (transportation.transportationCharges !== parseFloat(billing.amount)) {
            transportation.transportationCharges = parseFloat(billing.amount);
            updated = true;
          }
          if (transportation.companyGst !== transportGst.trim()) {
            transportation.companyGst = transportGst.trim();
            updated = true;
          }
          if (transportation.transportType !== transportType.trim()) {
            transportation.transportType = transportType.trim();
            updated = true;
          }
          if (updated) {
            await transportation.save();
          }
        }
      }
    }

    // Add payments if provided
    if (payments && payments.length > 0 && payments[0].amount > 0) {
      for (const payment of payments) {
        const trimmedBillId = payment.billId.trim();
        const paymentAmount = parseFloat(payment.amount);

        // Generate unique referenceId for each payment using UUID
        const paymentReferenceId = 'PAY' + Date.now().toString();

        // Avoid duplicate payments based on billId, amount, and method
        if (
          !transportPayment.payments.some(
            (p) =>
              p.billId === trimmedBillId &&
              p.amount === paymentAmount &&
              p.method === payment.method.trim()
          )
        ) {
          transportPayment.payments.push({
            referenceId: paymentReferenceId,
            amount: paymentAmount,
            method: payment.method.trim(),
            billId: trimmedBillId,
            submittedBy: payment.submittedBy.trim() || userId,
            date: payment.date ? new Date(payment.date) : new Date(),
            remark: payment.remark.trim(),
          });
        }
      }
    }

    // Save the updated TransportPayment document
    const savedTransportPayment = await transportPayment.save();

    res.status(201).json(savedTransportPayment);
  } catch (error) {
    console.error('Error creating transport payment:', error);
    res.status(400).json({ message: error.message });
  }
});





export default transportPaymentsRouter;
