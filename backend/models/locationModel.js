import mongoose from "mongoose";

const locationSchema = new mongoose.Schema({
  userId: { type: String, required: true }, // Driver's unique ID
  driverName: { type: String, required: true },
  invoiceNo: { type: String, required: true }, // Related invoice number
  startLocation: {
    coordinates: { type: [Number], required: true }, // [longitude, latitude]
    timestamp: { type: Date, default: Date.now }, // When the start was recorded
  },
  endLocation: {
    coordinates: { type: [Number] }, // [longitude, latitude]
    timestamp: { type: Date }, // When delivery was completed
  },
},{  timestamps: true });

const Location = mongoose.model("Location", locationSchema);
export default Location;