const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");
require("dotenv").config();
/* ============================
   APP CONFIG
============================ */
const app = express();
app.use(cors());
app.use(express.json());

/* ============================
   DATABASE CONNECTION (ATLAS)
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
   JWT MIDDLEWARE
============================ */
const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).send({ message: "Forbidden" });
    }
    req.user = decoded;
    next();
  });
};

const verifyRole = role => async (req, res, next) => {
  const user = await usersCol().findOne({ email: req.user.email });
  if (!user || user.role !== role) {
    return res.status(403).send({ message: "Access denied" });
  }
  next();
};


/* ============================
   AUTH & USERS
============================ */
app.post("/jwt", async (req, res) => {
  const user = req.body;
  const token = jwt.sign(user, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
  res.send({ token });
});

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

app.get("/users", verifyJWT, verifyRole("admin"), async (req, res) => {
  const users = await usersCol().find().toArray();
  res.send(users);
});

app.patch("/users/make-admin/:id", verifyJWT, verifyRole("admin"), async (req, res) => {
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

app.patch(
  "/decorators/approve/:id",
  verifyJWT,
  verifyRole("admin"),
  async (req, res) => {
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
  }
);