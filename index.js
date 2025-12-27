require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const admin = require("firebase-admin");

/* ============================
   STRIPE
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
   AUTH
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

  if (!user || user.role !== role)
    return res.status(403).send({ message: "Access denied" });

  next();
};

/* ============================
   ROOT
============================ */
app.get("/", (req, res) => {
  res.send("🎨 StyleDecor Server is running");
});

/* ============================
   USERS
============================ */
app.post("/users", async (req, res) => {
  const users = await usersCol();
  const existing = await users.findOne({ email: req.body.email });

  if (existing) return res.send({ message: "User already exists" });

  await users.insertOne(req.body);
  res.send({ success: true });
});

app.get("/users", verifyJWT, verifyRole("admin"), async (req, res) => {
  const users = await usersCol();
  res.send(await users.find().toArray());
});

app.get("/users/role", verifyJWT, async (req, res) => {
  const users = await usersCol();
  const user = await users.findOne({ email: req.user.email });

  if (!user) return res.status(404).send({ message: "User not found" });

  res.send({ role: user.role });
});

/* ============================
   BOOKINGS
============================ */
app.post("/bookings", verifyJWT, async (req, res) => {
  const bookings = await bookingsCol();
  await bookings.insertOne({
    ...req.body,
    createdAt: new Date(),
  });
  res.send({ success: true });
});

app.get("/bookings/user", verifyJWT, async (req, res) => {
  const bookings = await bookingsCol();
  res.send(await bookings.find({ userEmail: req.user.email }).toArray());
});

app.get("/bookings", verifyJWT, verifyRole("admin"), async (req, res) => {
  const bookings = await bookingsCol();
  res.send(await bookings.find().toArray());
});

/* ============================
   PAYMENTS
============================ */
app.post("/payments", verifyJWT, async (req, res) => {
  const payments = await paymentsCol();
  const bookings = await bookingsCol();

  const {
    bookingId,
    amount,
    transactionId,
    trackingId,
    email,
    serviceType,
    region,
  } = req.body;

  await payments.insertOne({
    bookingId,
    amount,
    transactionId,
    trackingId,
    email,
    serviceType,
    region,
    createdAt: new Date(),
  });

  await bookings.updateOne(
    { _id: new ObjectId(bookingId) },
    {
      $set: {
        paymentStatus: "paid",
        transactionId,
      },
    }
  );

  res.send({ success: true });
});

app.get("/payments", verifyJWT, async (req, res) => {
  const payments = await paymentsCol();
  res.send(await payments.find({ email: req.user.email }).toArray());
});

/* ============================
   DECORATORS
============================ */
app.get("/decorators/pending", verifyJWT, verifyRole("admin"), async (req, res) => {
  const decorators = await decoratorsCol();
  res.send(await decorators.find({ status: "pending" }).toArray());
});

app.get("/decorators", verifyJWT, verifyRole("admin"), async (req, res) => {
  const decorators = await decoratorsCol();
  res.send(await decorators.find({ status: "approved" }).toArray());
});

app.patch("/decorators/approve/:id", verifyJWT, verifyRole("admin"), async (req, res) => {
  const decorators = await decoratorsCol();
  await decorators.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { status: "approved" } }
  );
  res.send({ success: true });
});

/* ============================
   ✅ SERVICES (FIXED)
============================ */
app.get("/services", verifyJWT, async (req, res) => {
  const services = await servicesCol();

  const query = {
    decoratorEmail: req.user.email,
  };

  if (req.query.status) {
    query.status = req.query.status;
  }

  const result = await services.find(query).toArray();
  res.send(result);
});

/* ============================
   SERVICES ADMIN
============================ */
app.post("/services", verifyJWT, verifyRole("admin"), async (req, res) => {
  const services = await servicesCol();
  await services.insertOne({ ...req.body, createdAt: new Date() });
  res.send({ success: true });
});

/* ============================
   TRACKINGS
============================ */
app.post("/trackings", verifyJWT, async (req, res) => {
  const trackings = await trackingsCol();
  await trackings.insertOne({
    ...req.body,
    email: req.user.email,
    createdAt: new Date(),
  });
  res.send({ success: true });
});

app.get("/trackings", verifyJWT, async (req, res) => {
  const trackings = await trackingsCol();
  const user = await usersCol().then(c =>
    c.findOne({ email: req.user.email })
  );

  if (user.role === "admin") {
    return res.send(await trackings.find().toArray());
  }

  res.send(await trackings.find({ email: req.user.email }).toArray());
});

/* ============================
   EXPORT
============================ */
module.exports = app;
