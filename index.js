require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

/* ============================
   SAFE STRIPE INIT
============================ */
let stripe = null;
if (process.env.STRIPE_SECRET) {
  stripe = require("stripe")(process.env.STRIPE_SECRET);
} else {
  console.warn("⚠️ STRIPE_SECRET is missing");
}

/* ============================
   FIREBASE ADMIN INIT
============================ */
if (!admin.apps.length) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY
          ?.replace(/\\n/g, "\n")
          ?.replace(/"/g, ""),
      }),
    });
  } catch (err) {
    console.error("🔥 Firebase Admin Init Failed:", err);
  }
}

/* ============================
   APP CONFIG
============================ */
const app = express();

app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://styledecor-client.firebaseapp.com",
      "https://style-decor-sever.vercel.app",
    ],
    credentials: true,
  })
);

app.use(express.json());

/* ============================
   DATABASE CONNECTION
============================ */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_CLUSTER}/${process.env.DB_NAME}?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;
async function getDB() {
  if (!db) {
    await client.connect();
    db = client.db(process.env.DB_NAME);
  }
  return db;
}

/* ============================
   COLLECTIONS
============================ */
const usersCol = async () => (await getDB()).collection("users");
const bookingsCol = async () => (await getDB()).collection("bookings");
const decoratorsCol = async () => (await getDB()).collection("decorators");
const trackingsCol = async () => (await getDB()).collection("trackings");
const paymentsCol = async () => (await getDB()).collection("payments");
const servicesCol = async () => (await getDB()).collection("services");

/* ============================
   AUTH MIDDLEWARE
============================ */
const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  try {
    const token = authHeader.split(" ")[1];
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    return res.status(403).send({ message: "Forbidden" });
  }
};

const verifyRole = role => async (req, res, next) => {
  try {
    const users = await usersCol();
    const user = await users.findOne({ email: req.user.email });
    if (!user || user.role !== role)
      return res.status(403).send({ message: "Access denied" });
    next();
  } catch {
    res.status(500).send({ message: "Server error" });
  }
};

/* ============================
   ROUTES
============================ */
app.get("/", (req, res) => {
  res.send("🎨 StyleDecor Server is running");
});

/* ---------- USERS ---------- */
app.post("/users", async (req, res) => {
  const users = await usersCol();
  const exists = await users.findOne({ email: req.body.email });

  if (exists) return res.send({ message: "User already exists" });

  await users.insertOne({
    ...req.body,
    role: "user",
    createdAt: new Date(),
  });

  res.send({ message: "User created successfully" });
});

app.get("/users/role", verifyJWT, async (req, res) => {
  const users = await usersCol();
  const user = await users.findOne({ email: req.user.email });
  res.send({ role: user?.role || "user" });
});

/* ---------- BOOKINGS ---------- */
app.post("/bookings", verifyJWT, async (req, res) => {
  const bookings = await bookingsCol();
  await bookings.insertOne({
    ...req.body,
    paymentStatus: "unpaid",
    createdAt: new Date(),
  });
  res.send({ success: true });
});

app.get("/bookings/user", verifyJWT, async (req, res) => {
  const bookings = await bookingsCol();
  const result = await bookings.find({ userEmail: req.user.email }).toArray();
  res.send(result);
});

/* ---------- PAYMENTS (FIXED) ---------- */
app.post("/payments", verifyJWT, async (req, res) => {
  try {
    const {
      bookingId,
      amount,
      transactionId,
      trackingId,
      email,
      serviceType,
      region,
    } = req.body;

    if (!bookingId || !amount) {
      return res.status(400).send({ message: "Invalid payment data" });
    }

    const bookings = await bookingsCol();
    const payments = await paymentsCol();

    const booking = await bookings.findOne({
      _id: new ObjectId(bookingId),
    });

    if (!booking) {
      return res.status(404).send({ message: "Booking not found" });
    }

    // Save payment
    await payments.insertOne({
      bookingId: new ObjectId(bookingId),
      amount,
      transactionId,
      trackingId,
      email,
      serviceType,
      region,
      status: "paid",
      createdAt: new Date(),
    });

    // Update booking payment status
    await bookings.updateOne(
      { _id: new ObjectId(bookingId) },
      { $set: { paymentStatus: "paid" } }
    );

    // Tracking
    await trackingsCol().insertOne({
      bookingId,
      email,
      status: "Completed",
      createdAt: new Date(),
    });

    res.send({ success: true });
  } catch (error) {
    console.error("❌ PAYMENT ERROR:", error);
    res.status(500).send({ message: "Payment failed" });
  }
});

/* ============================
   EXPORT FOR VERCEL
============================ */
module.exports = app;
