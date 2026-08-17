// EID Tracker - Razorpay Backend (v3, signature-verified, no webhook needed)
//
// This does NOT trust the browser just because Checkout says "done."
// When Checkout completes, it hands back razorpay_payment_id,
// razorpay_order_id, and razorpay_signature. We recompute that signature
// server-side using our Key Secret - if it matches, the payment is proven
// genuine (this is Razorpay's standard verification method and does not
// require a webhook / Pro plan).

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
  console.error("Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET");
  process.exit(1);
}

const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

// In-memory store (fine for a small shop; swap for a real DB later).
const orders = new Map(); // order_id -> { paid, payment_id, receipt }

// ---- 1) Create an order ----
app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, receipt } = req.body;
    if (!amount || amount <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid amount" });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100),
      currency: "INR",
      receipt: receipt || "receipt_" + Date.now(),
    });

    orders.set(order.id, { paid: false, payment_id: null, receipt: order.receipt });

    res.json({
      ok: true,
      key_id: KEY_ID,
      amount: order.amount,
      currency: order.currency,
      order_id: order.id,
    });
  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({ ok: false, error: "Failed to create order" });
  }
});

// ---- 2) Verify payment (called right after Checkout's handler fires) ----
app.post("/api/verify-payment", (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ verified: false, error: "Missing fields" });
  }

  const body = razorpay_order_id + "|" + razorpay_payment_id;
  const expected = crypto
    .createHmac("sha256", KEY_SECRET)
    .update(body)
    .digest("hex");

  const isValid = expected === razorpay_signature;

  if (isValid) {
    const existing = orders.get(razorpay_order_id) || {};
    orders.set(razorpay_order_id, { ...existing, paid: true, payment_id: razorpay_payment_id });
    return res.json({ verified: true, payment_id: razorpay_payment_id });
  }

  return res.status(400).json({ verified: false, error: "Signature mismatch" });
});

// ---- 3) Order status (frontend polls this after calling verify-payment) ----
app.get("/api/order-status", (req, res) => {
  const orderId = req.query.order_id;
  if (!orderId) return res.status(400).json({ paid: false, error: "Missing order_id" });

  const order = orders.get(orderId);
  if (!order) return res.json({ paid: false });

  res.json({ paid: !!order.paid, details: { payment_id: order.payment_id } });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
