// EID Tracker - Backend
// Two jobs:
//   1) Accounts: register/login/change-pin, with ONE active session per
//      account (logging in on a new device invalidates the old device's
//      session — this is what makes "already logged in elsewhere" work).
//   2) Payments: create Razorpay order, verify signature after checkout,
//      report order status. Your Razorpay Key Secret only ever lives here.
//
// Needs a MongoDB connection string in MONGODB_URI (free tier on MongoDB
// Atlas is fine — see README.md for setup steps).

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const Razorpay = require("razorpay");

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const KEY_ID = process.env.RAZORPAY_KEY_ID;
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
const MONGODB_URI = process.env.MONGODB_URI;

if (!KEY_ID || !KEY_SECRET) {
  console.error("Missing RAZORPAY_KEY_ID or RAZORPAY_KEY_SECRET environment variables.");
  process.exit(1);
}
if (!MONGODB_URI) {
  console.error("Missing MONGODB_URI environment variable. See README.md for how to get a free one from MongoDB Atlas.");
  process.exit(1);
}

mongoose.connect(MONGODB_URI).then(
  () => console.log("MongoDB connected"),
  (err) => { console.error("MongoDB connection failed:", err.message); process.exit(1); }
);

const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET });

// ---------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------
const accountSchema = new mongoose.Schema({
  mobile: { type: String, unique: true, index: true, required: true },
  pinHash: { type: String, required: true },
  farmName: String,
  ownerName: String,
  // Only one of these is valid ("active") at a time. Logging in anywhere
  // replaces it, which is what forces every other device to be logged out.
  sessionToken: String,
  sessionCreatedAt: Date,
  data: {
    goats: { type: Array, default: [] },
    finance: { type: Array, default: [] },
    milkSales: { type: Object, default: {} },
    milkEntries: { type: Array, default: [] },
    tagOrders: { type: Array, default: [] },
  },
}, { timestamps: true });

const Account = mongoose.model("Account", accountSchema);

const orderSchema = new mongoose.Schema({
  razorpayOrderId: { type: String, unique: true, index: true },
  amount: Number,
  receipt: String,
  status: { type: String, default: "created" }, // created | paid
  paymentId: String,
}, { timestamps: true });

const Order = mongoose.model("Order", orderSchema);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
const cleanMobile = (m) => String(m || "").replace(/\D/g, "");
const newToken = () => crypto.randomBytes(24).toString("hex");
const publicProfile = (acc) => ({ mobile: acc.mobile, farmName: acc.farmName || "", ownerName: acc.ownerName || "" });

// Every account-data route must prove it holds the CURRENTLY active
// session for that mobile number. If another device logged in since,
// this device's token no longer matches and it gets logged out here.
async function requireSession(req, res, next) {
  const mobile = cleanMobile(req.header("x-mobile"));
  const token = req.header("x-session-token");
  if (!mobile || !token) return res.status(401).json({ ok: false, error: "Not logged in." });
  const acc = await Account.findOne({ mobile });
  if (!acc) return res.status(401).json({ ok: false, error: "Account not found." });
  if (!acc.sessionToken || acc.sessionToken !== token) {
    return res.status(401).json({ ok: false, error: "You were logged out because this account was signed in on another device.", code: "SESSION_REPLACED" });
  }
  req.account = acc;
  next();
}

// ---------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------
app.post("/api/register", async (req, res) => {
  try {
    const mobile = cleanMobile(req.body.mobile);
    const pin = String(req.body.pin || "");
    if (!/^\d{10}$/.test(mobile)) return res.json({ ok: false, error: "Enter a valid 10-digit mobile number." });
    if (!/^\d{4}$/.test(pin)) return res.json({ ok: false, error: "PIN must be 4 digits." });

    const existing = await Account.findOne({ mobile });
    if (existing) return res.json({ ok: false, error: "This number is already registered. Please login instead." });

    const pinHash = await bcrypt.hash(pin, 10);
    const token = newToken();
    const acc = await Account.create({
      mobile,
      pinHash,
      farmName: req.body.farmName || "",
      ownerName: req.body.ownerName || "",
      sessionToken: token,
      sessionCreatedAt: new Date(),
      data: { goats: [], finance: [], milkSales: {}, milkEntries: [], tagOrders: [] },
    });
    res.json({ ok: true, token, profile: publicProfile(acc), data: acc.data });
  } catch (err) {
    console.error("register error:", err);
    res.status(500).json({ ok: false, error: "Could not register. Please try again." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const mobile = cleanMobile(req.body.mobile);
    const pin = String(req.body.pin || "");
    const acc = await Account.findOne({ mobile });
    if (!acc) return res.json({ ok: false, error: "No account found for this number. Please register first." });

    const match = await bcrypt.compare(pin, acc.pinHash);
    if (!match) return res.json({ ok: false, error: "Incorrect PIN." });

    // New session replaces any old one — the previous device's stored
    // token now fails requireSession() and gets bounced to the login screen.
    const token = newToken();
    acc.sessionToken = token;
    acc.sessionCreatedAt = new Date();
    await acc.save();

    res.json({ ok: true, token, profile: publicProfile(acc), data: acc.data });
  } catch (err) {
    console.error("login error:", err);
    res.status(500).json({ ok: false, error: "Could not login. Please try again." });
  }
});

app.post("/api/logout", requireSession, async (req, res) => {
  req.account.sessionToken = null;
  await req.account.save();
  res.json({ ok: true });
});

app.post("/api/change-pin", requireSession, async (req, res) => {
  const currentPin = String(req.body.currentPin || "");
  const newPin = String(req.body.newPin || "");
  if (!/^\d{4}$/.test(newPin)) return res.json({ ok: false, error: "New PIN must be 4 digits." });
  const match = await bcrypt.compare(currentPin, req.account.pinHash);
  if (!match) return res.json({ ok: false, error: "Current PIN is incorrect." });
  req.account.pinHash = await bcrypt.hash(newPin, 10);
  await req.account.save();
  res.json({ ok: true });
});

// Change mobile number: the account itself moves to the new number
// (confirmed with the current PIN), and the session stays valid.
app.post("/api/change-mobile", requireSession, async (req, res) => {
  const newMobile = cleanMobile(req.body.newMobile);
  const currentPin = String(req.body.currentPin || "");
  if (!/^\d{10}$/.test(newMobile)) return res.json({ ok: false, error: "Enter a valid 10-digit mobile number." });
  const pinOk = await bcrypt.compare(currentPin, req.account.pinHash);
  if (!pinOk) return res.json({ ok: false, error: "Current PIN is incorrect." });
  const clash = await Account.findOne({ mobile: newMobile });
  if (clash) return res.json({ ok: false, error: "This number is already registered on another account." });
  req.account.mobile = newMobile;
  await req.account.save();
  res.json({ ok: true, profile: publicProfile(req.account) });
});

// Pull the latest data + profile for the account (used on app load so a
// device always shows what's actually on the server, not stale local data).
app.get("/api/account", requireSession, async (req, res) => {
  res.json({ ok: true, profile: publicProfile(req.account), data: req.account.data });
});

// Push updated data (goats/finance/milk/tag orders and/or names) up to the
// server. Whatever fields are included replace that field entirely.
app.put("/api/account/data", requireSession, async (req, res) => {
  const { goats, finance, milkSales, milkEntries, tagOrders, farmName, ownerName } = req.body || {};
  if (goats !== undefined) req.account.data.goats = goats;
  if (finance !== undefined) req.account.data.finance = finance;
  if (milkSales !== undefined) req.account.data.milkSales = milkSales;
  if (milkEntries !== undefined) req.account.data.milkEntries = milkEntries;
  if (tagOrders !== undefined) req.account.data.tagOrders = tagOrders;
  if (farmName !== undefined) req.account.farmName = farmName;
  if (ownerName !== undefined) req.account.ownerName = ownerName;
  req.account.markModified("data");
  await req.account.save();
  res.json({ ok: true });
});

// ---------------------------------------------------------------------
// Payments (Razorpay) — same behaviour as before, now persisted in Mongo
// instead of an in-memory Map so it survives Render restarts/sleeps.
// ---------------------------------------------------------------------
app.post("/api/create-order", async (req, res) => {
  try {
    const { amount, receipt } = req.body;
    if (!amount || amount <= 0) return res.status(400).json({ ok: false, error: "Invalid amount" });

    const order = await razorpay.orders.create({
      amount: Math.round(amount * 100), // paise
      currency: "INR",
      receipt: receipt || "receipt_" + Date.now(),
    });

    await Order.create({ razorpayOrderId: order.id, amount, receipt: receipt || "", status: "created" });

    res.json({ ok: true, order_id: order.id, amount: order.amount, currency: order.currency, key_id: KEY_ID });
  } catch (err) {
    console.error("create-order error:", err);
    res.status(500).json({ ok: false, error: "Failed to create order" });
  }
});

app.post("/api/verify-payment", async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ verified: false, error: "Missing fields" });
    }
    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expected = crypto.createHmac("sha256", KEY_SECRET).update(body).digest("hex");
    const isValid = expected === razorpay_signature;

    if (isValid) {
      await Order.findOneAndUpdate(
        { razorpayOrderId: razorpay_order_id },
        { status: "paid", paymentId: razorpay_payment_id }
      );
      return res.json({ verified: true, paymentId: razorpay_payment_id });
    }
    res.status(400).json({ verified: false, error: "Signature mismatch" });
  } catch (err) {
    console.error("verify-payment error:", err);
    res.status(500).json({ verified: false, error: "Verification failed" });
  }
});

app.get("/api/order-status", async (req, res) => {
  const orderId = req.query.order_id;
  const order = await Order.findOne({ razorpayOrderId: orderId });
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ paid: order.status === "paid", details: { payment_id: order.paymentId || null, status: order.status } });
});

app.get("/", (req, res) => res.send("EID Tracker backend is running."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
