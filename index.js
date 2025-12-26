require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

/* ============================
   STRIPE (SAFE)
============================ */
let stripe = null;
if (process.env.STRIPE_SECRET) {
  stripe = require("stripe")(process.env.STRIPE_SECRET);
}

/* ============================
   FIREBASE ADMIN
============================ */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ?.replace(/\\n/g, "\n")
        ?.replace(/"/g, ""),
    }),
  });
}

/* ============================
   APP SETUP
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
   DATABASE
============================ */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_CLUSTER}/${process.env.DB_NAME}?retryWrites=true&w=majority`;

const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1 },
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
  if (!authHeader?.startsWith("Bearer "))
    return res.status(401).send({ message: "Unauthorized" });

  try {
    const token = authHeader.split(" ")[1];
    req.user = await admin.auth().verifyIdToken(token);
    next();
  } catch {
    res.status(403).send({ message: "Forbidden" });
  }
};

const verifyRole = role => async (req, res, next) => {
  const users = await usersCol();
  const user = await users.findOne({ email: req.user.email });

  if (!user || user.role !== role) {
    return res.status(403).send({ message: "Access denied" });
  }

  next();
};

/* ============================
   ROOT
============================ */
app.get("/", (req, res) => {
  res.send("🎨 StyleDecor Server is running");
});

/* ============================
   🔥 ROLE CHECK (FIXED)
============================ */
app.get("/users/role", verifyJWT, async (req, res) => {
  try {
    const users = await usersCol();
    const user = await users.findOne({ email: req.user.email });

    res.send({ role: user?.role || "user" });
  } catch (err) {
    res.status(500).send({ role: "user" });
  }
});

/* ============================
   USERS (ADMIN)
============================ */
app.get("/users", verifyJWT, verifyRole("admin"), async (req, res) => {
  const users = await usersCol();
  res.send(await users.find().toArray());
});

app.patch("/users/make-admin/:id", verifyJWT, verifyRole("admin"), async (req, res) => {
  const users = await usersCol();
  await users.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { role: "admin" } }
  );
  res.send({ message: "User promoted to admin" });
});

app.patch("/users/block/:id", verifyJWT, verifyRole("admin"), async (req, res) => {
  const users = await usersCol();
  const user = await users.findOne({ _id: new ObjectId(req.params.id) });

  await users.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { blocked: !user.blocked } }
  );

  res.send({ message: "Status updated" });
});

app.delete("/users/:id", verifyJWT, verifyRole("admin"), async (req, res) => {
  const users = await usersCol();
  await users.deleteOne({ _id: new ObjectId(req.params.id) });
  res.send({ message: "User deleted" });
});

/* ============================
   BOOKINGS
============================ */
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
  res.send(await bookings.find({ userEmail: req.user.email }).toArray());
});

/* ============================
   PAYMENTS
============================ */
app.post("/payments", verifyJWT, async (req, res) => {
  const { bookingId, amount } = req.body;

  const bookings = await bookingsCol();
  const payments = await paymentsCol();
  const trackings = await trackingsCol();

  const booking = await bookings.findOne({ _id: new ObjectId(bookingId) });
  if (!booking) return res.status(404).send({ message: "Booking not found" });

  await payments.insertOne({
    bookingId,
    amount,
    userEmail: req.user.email,
    createdAt: new Date(),
  });

  await bookings.updateOne(
    { _id: booking._id },
    { $set: { paymentStatus: "paid" } }
  );

  await trackings.insertOne({
    bookingId,
    userEmail: req.user.email,
    status: "Completed",
    createdAt: new Date(),
  });

  res.send({ success: true });
});

app.get("/payments", verifyJWT, async (req, res) => {
  const payments = await paymentsCol();
  const bookings = await bookingsCol();

  const data = await payments
    .find({ userEmail: req.user.email })
    .sort({ createdAt: -1 })
    .toArray();

  const result = await Promise.all(
    data.map(async p => {
      const booking = await bookings.findOne({ _id: new ObjectId(p.bookingId) });
      return {
        ...p,
        serviceType: booking?.serviceType,
      };
    })
  );

  res.send(result);
});

/* ============================
   EXPORT
============================ */
module.exports = app;
