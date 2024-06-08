const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const port = process.env.PORT || 5000;
// TODO: verify em verify admin
// middleware
const corsOptions = {
  origin: ["http://localhost:5173", "http://localhost:5174"],
  credentials: true,
  optionSuccessStatus: 200,
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  // console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const {
  MongoClient,
  ServerApiVersion,
  Timestamp,
  ObjectId,
} = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.6u1ikeh.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();
    const userCollection = client.db("aweiDb").collection("users");
    const workSheetCollection = client.db("aweiDb").collection("workSheets");
    const paymentsCollection = client.db("aweiDb").collection("payments");

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });
    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });
    // create-payment-intent
    app.post("/create-payment-intent", verifyToken, async (req, res) => {
      const salary = req.body.salary;
      const salaryInCent = parseFloat(salary) * 100;
      if (!salary || salaryInCent < 1) return;
      // generate clientSecret
      const { client_secret } = await stripe.paymentIntents.create({
        amount: salaryInCent,
        currency: "usd",
        // In the latest version of the API, specifying the `automatic_payment_methods` parameter is optional because Stripe enables its functionality by default.
        automatic_payment_methods: {
          enabled: true,
        },
      });
      // send client secret as response
      res.send({ clientSecret: client_secret });
    });

    // user user
    app.post("/users", async (req, res) => {
      const user = req.body;

      const query = { email: user?.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exist", insertedId: null });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // get a user info by email from db
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await userCollection.findOne({ email });
      res.send(result);
    });
    // get employees
    app.get("/employees", async (req, res) => {
      try {
        const employees = await userCollection
          .find({ role: "Employee" })
          .toArray();
        res.send(employees);
      } catch {
        res.status(500).send({ message: "Error" });
      }
    });

    app.patch("/employees/update/:email", async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const query = { email };
      const updateDoc = {
        $set: {
          ...user,
        },
      };
      const result = await userCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // work-sheet
    app.post("/workSheets", async (req, res) => {
      const item = req.body;
      const result = await workSheetCollection.insertOne(item);
      res.send(result);
    });

    // get a work-sheet info by email from db

    app.get("/workSheet/:email", async (req, res) => {
      const email = req.params.email;
      let query = { email: email };
      const result = await workSheetCollection.find(query).toArray();
      res.send(result);
    });

    // get all users data from db
    app.get("/payments", verifyToken,  async (req, res) => {
      const result = await paymentsCollection.find().toArray();
      res.send(result);
    });

    // get a payments info by id from db
    app.get("/payments/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await paymentsCollection.findOne(query);
      res.send(result);
    });

    // payment
    app.post("/payments", verifyToken, async (req, res) => {
      const paymentData = req.body;
      const result = await paymentsCollection.insertOne(paymentData);
      const paymentId = paymentData?.employeeId;
      const query = { _id: new ObjectId(paymentId) };
      const updateDoc = {
        $set: { payment: true },
      };
      const updatedPayment = await userCollection.updateOne(query, updateDoc);
      console.log(updatedPayment);

      res.send({ result, updatedPayment });
    });
    
    // 
    app.get('/employee-list', async (req, res) => {
      const { page = 1, limit = 5 } = req.query;
    
      try {
        const payments = await paymentsCollection.find()
          .sort({ payYear: 1, payMonth: 1 })  
          .skip((page - 1) * limit)
          .limit(parseInt(limit))
          .toArray();
    
        const count = await paymentsCollection.countDocuments();
    
        res.send({
          payments,
          totalPages: Math.ceil(count / limit),
          currentPage: parseInt(page)
        });
      } catch (error) {
        res.status(500).json({ error: 'Something went wrong' });
      }
    });


    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("server is running");
});
app.listen(port, () => {
  console.log(`awei is running on ${port}`);
});
