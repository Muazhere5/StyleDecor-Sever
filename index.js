require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const { MongoClient, ObjectId, ServerApiVersion } = require("mongodb");

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

/* ============================
   SERVICES (ADMIN CRUD)
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
   BOOKINGS (USER)
============================ */
app.post("/bookings", verifyJWT, async (req, res) => {
  const booking = req.body;

  booking.userEmail = req.user.email;
  booking.status = "unpaid";
  booking.createdAt = new Date();

  const result = await bookingsCol().insertOne(booking);
  res.send(result);
});

app.get("/bookings/user", verifyJWT, async (req, res) => {
  const bookings = await bookingsCol()
    .find({ userEmail: req.user.email })
    .toArray();
  res.send(bookings);
});

app.get("/bookings/admin", verifyJWT, verifyRole("admin"), async (req, res) => {
  const bookings = await bookingsCol().find().toArray();
  res.send(bookings);
});


/* ============================
   ASSIGN DECORATOR (ADMIN)
============================ */
app.patch(
  "/bookings/assign/:id",
  verifyJWT,
  verifyRole("admin"),
  async (req, res) => {
    const { decoratorEmail } = req.body;

    await bookingsCol().updateOne(
      { _id: new ObjectId(req.params.id) },
      {
        $set: {
          decoratorEmail,
          status: "assigned",
        },
      }
    );

    await trackingCol().insertOne({
      bookingId: req.params.id,
      status: "Decorator Assigned",
      date: new Date(),
    });

    res.send({ message: "Decorator assigned" });
  }
); 

/* ============================
   STRIPE PAYMENT
============================ */
app.post("/create-payment-intent", verifyJWT, async (req, res) => {
  const { price } = req.body;

  const paymentIntent = await stripe.paymentIntents.create({
    amount: price * 100,
    currency: "bdt",
    payment_method_types: ["card"],
  });

  res.send({ clientSecret: paymentIntent.client_secret });
});

app.post("/payments", verifyJWT, async (req, res) => {
  const payment = req.body;
  payment.date = new Date();

  await paymentsCol().insertOne(payment);

  await bookingsCol().updateOne(
    { _id: new ObjectId(payment.bookingId) },
    {
      $set: {
        status: "paid",
        trackingNo: Math.floor(100000 + Math.random() * 900000),
      },
    }
  );

  await trackingCol().insertOne({
    bookingId: payment.bookingId,
    status: "Payment Completed",
    date: new Date(),
  });

  res.send({ message: "Payment successful" });
});

/* ============================
   DECORATOR DASHBOARD
============================ */
app.get(
  "/decorator/tasks",
  verifyJWT,
  verifyRole("decorator"),
  async (req, res) => {
    const tasks = await bookingsCol()
      .find({ decoratorEmail: req.user.email })
      .toArray();
    res.send(tasks);
  }
);

app.patch(
  "/decorator/update-status/:id",
  verifyJWT,
  verifyRole("decorator"),
  async (req, res) => {
    const { status } = req.body;

    await bookingsCol().updateOne(
      { _id: new ObjectId(req.params.id) },
      { $set: { status } }
    );

    await trackingCol().insertOne({
      bookingId: req.params.id,
      status,
      date: new Date(),
    });

    res.send({ message: "Status updated" });
  }
);

/* ============================
   TRACKING
============================ */
app.get("/tracking/:id", async (req, res) => {
  const tracking = await trackingCol()
    .find({ bookingId: req.params.id })
    .toArray();
  res.send(tracking);
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