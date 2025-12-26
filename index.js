require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

/* ============================
   FIREBASE ADMIN INIT
============================ */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
    }),
  });
}

/* ============================
   APP CONFIG
============================ */
const app = express();

/* ✅ FIXED CORS (IMPORTANT) */
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "https://style-decor-sever.vercel.app",
      "https://styledecor-client.firebaseapp.com",
    ],
    credentials: true,
  })
);

/* ✅ REQUIRED FOR VERCEL PREFLIGHT */
app.options("*", cors());

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
async function connectDB() {
  if (db) return db;
  await client.connect();
  db = client.db(process.env.DB_NAME);
  return db;
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
   MIDDLEWARE
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
  const exists = await usersCol().findOne({ email: req.body.email });
  if (exists) return res.send({ message: "User already exists" });

  await usersCol().insertOne({
    ...req.body,
    role: "user",
    createdAt: new Date(),
  });

  res.send({ message: "User created successfully" });
});

/* ✅ ADMIN: GET ALL USERS */
app.get("/users", verifyJWT, verifyRole("admin"), async (req, res) => {
  res.send(await usersCol().find().toArray());
});

/* ✅ FIX: ROLE API (CRITICAL) */
app.get("/users/role", verifyJWT, async (req, res) => {
  const user = await usersCol().findOne({ email: req.user.email });

  if (!user) {
    return res.send({ role: "user" });
  }

  res.send({ role: user.role });
});

/* ============================
   ROOT
============================ */
app.get("/", (req, res) => {
  res.send("🎨 StyleDecor Server is running");
});

/* ============================
   EXPORT FOR VERCEL
============================ */
module.exports = app;
