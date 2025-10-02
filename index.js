require('dotenv').config()
const express = require('express')
const cors = require('cors')
const cookieParser = require('cookie-parser')
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const jwt = require('jsonwebtoken')
const morgan = require('morgan')

const port = process.env.PORT || 5000
const app = express()

// middleware
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:5174'
  ],

  credentials: true,
  optionSuccessStatus: 200,
}
app.use(cors(corsOptions))

app.use(express.json())
app.use(cookieParser())
app.use(morgan('dev'))

const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token

  if (!token) {
    return res.status(401).send({ message: 'unauthorized access' })
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err)
      return res.status(401).send({ message: 'unauthorized access' })
    }
    req.user = decoded
    next()
  })
}

// Database connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.p62hq.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
})
async function run() {
  try {
    const database = client.db('PlantBayDB')
    const usersCollection = database.collection('users')
    const plantsCollection = database.collection('plants')
    const ordersCollection = database.collection('orders')

    // Verify Admin Middleware
    const verifyAdmin = async (req, res, next) => {

      console.log("Verifying admin...", req.user);

      const email = req.user.email
      const filter = { email }
      const result = await usersCollection.findOne(filter)

      if (!result || result.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access! Action only Admin' })
      }
      console.log("Admin verified");
      next()
    }

    // Verify Seller Middleware
    const verifySeller = async (req, res, next) => {

      console.log("Verifying Seller...", req.user);

      const email = req.user.email
      const filter = { email }
      const result = await usersCollection.findOne(filter)

      if (!result || result.role !== 'seller') {
        return res.status(403).send({ message: 'forbidden access! Action only  Seller' })
      }
      console.log("Admin verified");
      next()
    }



    // Generate jwt token
    app.post('/jwt', async (req, res) => {
      const email = req.body
      const token = jwt.sign(email, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: '365d',
      })
      res
        .cookie('token', token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
        })
        .send({ success: true })
    })

    // Logout
    app.get('/logout', async (req, res) => {
      try {
        res
          .clearCookie('token', {
            maxAge: 0,
            secure: process.env.NODE_ENV === 'production',
            sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'strict',
          })
          .send({ success: true })
      } catch (err) {
        res.status(500).send(err)
      }
    })

    /**
     * Users Api
     */
    // 1. Save or Update users in db
    app.post('/users/:email', async (req, res) => {
      const email = req.params.email
      const user = req.body

      const filter = { email }

      // check user exists in db
      const isExist = await usersCollection.findOne(filter)
      if (isExist) {
        return res.send({ message: "User Already exist.", isExist })
      }

      const result = await usersCollection.insertOne(
        {
          ...user,
          role: 'customer',
          timeStamp: Date.now()

        })
      res.send(result)
    })

    // Admin Routes
    // Get all users except logged in user in Manage Users Section
    app.get('/all-users/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const filter = { email: { $ne: email } }

      const result = await usersCollection.find(filter).toArray()
      res.send(result)
    })

    // Update user role and status
    app.patch('/users/role/:email', verifyToken, verifyAdmin, async (req, res) => {
      const email = req.params.email
      const { role } = req.body
      const filter = { email }

      const updateDoc = {
        $set: {
          role,
          status: 'Verified'
        }
      }

      const result = await usersCollection.updateOne(filter, updateDoc)
      res.send(result)
    })


    /**
     * Manage Users role
     */
    app.patch("/users/:email", verifyToken, async (req, res) => {
      const email = req.params.email
      const filter = { email }

      const user = await usersCollection.findOne(filter)
      if (!user || user?.status === 'Requested') {
        return res
          .status(404)
          .send({ message: 'User not found or request is pending' })
      }

      const updateDoc = {
        $set: {
          status: 'Requested'
        }
      }

      const result = await usersCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email
      const filter = { email }
      const user = await usersCollection.findOne(filter)
      if (!user) {
        return res.status(404).send({ message: 'User not found' })
      }

      res.send({ role: user?.role })
    })


    /**
     * Plants Api
     */
    app.get('/plants/seller', verifyToken, verifySeller, async (req, res) => {
      const email = req.user?.email
      const filter = { "seller.email": email }
      const result = await plantsCollection.find(filter).toArray()
      res.send(result)
    })

    // 2. Save plants data in db
    app.post('/plants', async (req, res) => {
      const plant = req.body
      const result = await plantsCollection.insertOne(plant)
      res.send(result)
    })

    app.get('/plants', async (req, res) => {
      const result = await plantsCollection.find().toArray()
      res.send(result)
    })

    app.get("/plants/:id", async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }

      const result = await plantsCollection.findOne(filter)
      res.send(result)
    })

    app.delete('/plants/:id', verifyToken, verifySeller, async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }
      const result = await plantsCollection.deleteOne(filter)
      res.send(result)
    })

    /**
     * Orders Api
     */
    // 3. Save orders data in db
    app.post('/orders', verifyToken, async (req, res) => {
      const order = req.body
      console.log(order);
      const result = await ordersCollection.insertOne(order)
      res.send(result)
    })

    // Manage plant quantity (increment/decrement)
    app.patch('/plants/quantity/:id', async (req, res) => {
      const id = req.params.id
      const { quantityToUpdate, status } = req.body

      console.log("ID:", id);
      console.log("Quantity to update:", quantityToUpdate);
      console.log("Status:", status);

      const filter = { _id: new ObjectId(id) }
      let incValue = -quantityToUpdate;

      if (status === 'increase') {
        incValue = quantityToUpdate;
      }

      const updateDoc = {
        $inc: {
          quantity: incValue
        }
      }

      const result = await plantsCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    /**
     * Customer Orders Api
     */
    // 4. Get all orders of a specific customer
    app.get('/customers-orders/:email', async (req, res) => {
      const email = req.params.email;
      const filter = { 'userInfo.email': email };

      const result = await ordersCollection.aggregate([
        {
          $match: filter
        },
        {
          $addFields:
          {
            plantId:
            {
              $toObjectId: "$plantInfo.plantId"

            }
          }
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plantDoc'
          }
        },
        {
          $unwind: "$plantDoc"
        },
        {
          $addFields: {
            image: "$plantDoc.image",
            name: "$plantDoc.name",
            category: "$plantDoc.category",
            price: "$plantDoc.price",
            quantity: "$plantInfo.totalQuantity"
          }
        },
        {
          $project: {
            plantDoc: 0,
            // plantInfo: 0
          }
        }
      ]).toArray();

      res.send(result);
    })

    // Get all orders of a specific seller
    app.get('/manage-orders/:email', verifyToken, verifySeller, async (req, res) => {
      const email = req.params.email;
      const filter = { seller: email };

      const result = await ordersCollection.aggregate([
        {
          $match: filter
        },
        {
          $addFields:
          {
            plantId:
            {
              $toObjectId: "$plantInfo.plantId"
            }
          }
        },
        {
          $lookup: {
            from: 'plants',
            localField: 'plantId',
            foreignField: '_id',
            as: 'plantDoc'
          }
        },
        {
          $unwind: "$plantDoc"
        },
        {
          $addFields: {
            name: "$plantDoc.name",
          }
        },
        {
          $project: {
            plantDoc: 0,
          }
        }
      ]).toArray();
      res.send(result);
    })

    // Update order status by id
    app.patch('/orders/status/:id', async (req, res) => {
      const id = req.params.id
      const { status } = req.body

      const filter = { _id: new ObjectId(id) }
      
      const updateDoc = {
        $set: {
          status
        }
      }
      const result = await ordersCollection.updateOne(filter, updateDoc)
      res.send(result)
    })

    // Handle delete order by id
    app.delete('/orders/:id', async (req, res) => {
      const id = req.params.id
      const filter = { _id: new ObjectId(id) }

      const order = await ordersCollection.findOne(filter)
      console.log("Current order status:", order.status);

      if (order.status === 'Delivered') {
        return res.status(409).send({ message: 'You can not delete delivered order' })
      }

      const result = await ordersCollection.deleteOne(filter)
      res.send(result)
    })




    // Send a ping to confirm a successful connection
    await client.db('admin').command({ ping: 1 })
    console.log(
      'Pinged your deployment. You successfully connected to MongoDB!'
    )
  } finally {
    // Ensures that the client will close when you finish/error
  }
}
run().catch(console.dir)

app.get('/', (req, res) => {
  res.send('Hello from PlantBay Server..')
})

app.listen(port, () => {
  console.log(`PlantBay is running on port ${port}`)
})
