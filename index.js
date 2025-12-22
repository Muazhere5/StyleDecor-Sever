require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

/* ============================
   FIREBASE ADMIN INIT
============================ */
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  }),
});

/* ============================
   APP CONFIG
============================ */
const app = express();
app.use(cors());
app.use(express.json());

/* ============================
   DATABASE CONNECTION
============================ */
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@${process.env.DB_CLUSTER}/${process.env.DB_NAME}?retryWrites=true&w=majority&appName=Project00`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

let db;

async function connectDB() {
  try {
    await client.connect();
    db = client.db(process.env.DB_NAME);
    console.log("✅ MongoDB Atlas connected successfully");
  } catch (error) {
    console.error("❌ MongoDB connection failed:", error);
  }
}
connectDB();

/* ============================
   COLLECTIONS
============================ */
const usersCol = () => db.collection("users");
const decoratorsCol = () => db.collection("decorators");
const servicesCol = () => db.collection("services");
const bookingsCol = () => db.collection("bookings");
const paymentsCol = () => db.collection("payments");
const trackingCol = () => db.collection("trackings");

/* ============================
   FIREBASE TOKEN MIDDLEWARE
============================ */
const verifyJWT = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(403).send({ message: "Forbidden" });
  }
};

const verifyRole = role => async (req, res, next) => {
  const user = await usersCol().findOne({ email: req.user.email });
  if (!user || user.role !== role) {
    return res.status(403).send({ message: "Access denied" });
  }
  next();
};

/* ============================
   USERS
============================ */
app.post("/users", async (req, res) => {
  const user = req.body;
  const exists = await usersCol().findOne({ email: user.email });

  if (exists) {
    return res.send({ message: "User already exists" });
  }

  user.role = "user";
  user.createdAt = new Date();

  await usersCol().insertOne(user);
  res.send({ message: "User created successfully" });
});

/* =========================================================
   🚨 TEMPORARY ADMIN BYPASS
   🔓 Allows any logged-in user to view users
   ⚠️ REMOVE verifyJWT ONLY AFTER YOU BECOME ADMIN
========================================================= */
app.get("/users", verifyJWT, async (req, res) => {
  const users = await usersCol().find().toArray();
  res.send(users);
});

/* ============================
   MAKE ADMIN (KEEP PROTECTED)
============================ */
app.patch("/users/make-admin/:id", verifyJWT, async (req, res) => {
  await usersCol().updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { role: "admin" } }
  );
  res.send({ message: "User promoted to admin" });
});

/* ============================
   DECORATOR MANAGEMENT
============================ */
app.post("/decorators/apply", verifyJWT, async (req, res) => {
  const data = req.body;
  data.status = "pending";
  data.createdAt = new Date();

  await decoratorsCol().insertOne(data);
  res.send({ message: "Decorator application submitted" });
});

app.get("/decorators", async (req, res) => {
  const decorators = await decoratorsCol()
    .find({ status: "approved" })
    .toArray();
  res.send(decorators);
});

app.patch("/decorators/approve/:id", verifyJWT, verifyRole("admin"), async (req, res) => {
  const decorator = await decoratorsCol().findOne({
    _id: new ObjectId(req.params.id),
  });

  await decoratorsCol().updateOne(
    { _id: decorator._id },
    { $set: { status: "approved" } }
  );

  await usersCol().updateOne(
    { email: decorator.email },
    { $set: { role: "decorator" } }
  );

  res.send({ message: "Decorator approved" });
});

/* ============================
   SERVICES
============================ */
app.post("/services", verifyJWT, verifyRole("admin"), async (req, res) => {
  const service = req.body;
  service.createdBy = req.user.email;
  service.createdAt = new Date();

  await servicesCol().insertOne(service);
  res.send({ message: "Service created" });
});

app.get("/services", async (req, res) => {
  const services = await servicesCol().find().toArray();
  res.send(services);
});

/* ============================
   SERVER START
============================ */
app.get("/", (req, res) => {
  res.send("🎨 StyleDecor Server is running");
});

app.listen(process.env.PORT, () => {
  console.log(`🚀 StyleDecor Server running on port ${process.env.PORT}`);
});
