// EID Tracker - Razorpay Backend
// This server is the ONLY place your Razorpay Key Secret should ever live.
// It never gets sent to the browser.

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const Razorpay = require("razorpay");

const app = express();
app.use(cors());
app.use(express.json());

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;

if (!KEY_ID || !KEY_SECRET) {
  console.error(
    "Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET environment variables."
  );
  process.exit(1);
}

const razorpay = new Razorpay({
  key_id: KEY_ID,
  key_secret: KEY_SECRET,
});

// In-memory store just for demo purposes (swap for a real DB in production).
const orders = new Map();

// 1) Create an order. The frontend calls this BEFORE opening Razorpay Checkout.
app.post("/create-order", async (req, res) => {
  try {
    const { amount, notes } = req.body; // amount in rupees, e.g. 450
    if (!amount || amount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Razorpay wants paise
      currency: "INR",
      receipt: "receipt_" + Date.now(),
      notes: notes || {},
    });

    orders.set(order.id, { status: "created", amount });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: KEY_ID, // safe to expose - it's the public key
    });
  } catch (err) {
    console.error("Error creating order:", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// 2) Verify payment. The frontend calls this AFTER Razorpay Checkout closes.
// This is the step that proves a payment was genuinely successful -
// it recomputes the signature using the secret key and compares it.
app.post("/verify-payment", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ verified: false, error: "Missing fields" });
  }

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expectedSignature = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(body)
    .digest("hex");

  const isValid = expectedSignature === razorpay_signature;

  if (isValid) {
    const order = orders.get(razorpay_order_id);
    if (order) order.status = "paid";
    return res.json({ verified: true, paymentId: razorpay_payment_id });
  }

  return res.status(400).json({ verified: false, error: "Signature mismatch" });
});

// 3) Optional: check status of an order at any time
app.get("/order-status/:orderId", (req, res) => {
  const order = orders.get(req.params.orderId);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(order);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
