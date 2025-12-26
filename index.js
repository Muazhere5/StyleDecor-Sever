require("dotenv").config();
const express = require("express");
const cors = require("cors");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
const admin = require("firebase-admin");

/* ============================
   FIREBASE ADMIN INIT (FIXED)
============================ */
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY
        ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
        : undefined,
    }),
  });
}

/* ============================
   APP CONFIG
============================ */
const app = express();

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

app.options("*", cors());
app.use(express.json());

/* ============================
   DATABASE CONNECTION (FIXED)
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
   COLLECTIONS (SAFE)
============================ */
const usersCol = async () => (await getDB()).collection("users");
const decoratorsCol = async () => (await getDB()).collection("decorators");
const servicesCol = async () => (await getDB()).collection("services");
const bookingsCol = async () => (await getDB()).collection("bookings");
const paymentsCol = async () => (await getDB()).collection("payments");
const trackingCol = async () => (await getDB()).collection("trackings");

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
  } catch (err) {
    console.error("JWT Error:", err);
    res.status(403).send({ message: "Forbidden" });
  }
};

const verifyRole = role => async (req, res, next) => {
  try {
    const users = await usersCol();
    const user = await users.findOne({ email: req.user.email });

    if (!user || user.role !== role) {
      return res.status(403).send({ message: "Access denied" });
    }
    next();
  } catch (err) {
    console.error("Role Error:", err);
    res.status(500).send({ message: "Server error" });
  }
};

/* ============================
   USERS ROUTES
============================ */
app.post("/users", async (req, res) => {
  try {
    const users = await usersCol();
    const exists = await users.findOne({ email: req.body.email });

    if (exists) return res.send({ message: "User already exists" });

    await users.insertOne({
      ...req.body,
      role: "user",
      createdAt: new Date(),
    });

    res.send({ message: "User created successfully" });
  } catch (err) {
    console.error("POST /users:", err);
    res.status(500).send({ message: "Server error" });
  }
});

app.get("/users", verifyJWT, verifyRole("admin"), async (req, res) => {
  try {
    const users = await usersCol();
    res.send(await users.find().toArray());
  } catch (err) {
    console.error("GET /users:", err);
    res.status(500).send({ message: "Server error" });
  }
});

app.get("/users/role", verifyJWT, async (req, res) => {
  try {
    const users = await usersCol();
    const user = await users.findOne({ email: req.user.email });

    if (!user) {
      return res.send({ role: "user" });
    }

    res.send({ role: user.role });
  } catch (err) {
    console.error("GET /users/role:", err);
    res.status(500).send({ role: "user" });
  }
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
