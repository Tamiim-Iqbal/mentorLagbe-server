import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";

const app = express();
const PORT = process.env.PORT || 8000;

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [
      "https://web-mentor-lagbe.vercel.app",
      "http://localhost:3000",
    ],
    credentials: true,
  })
);

// MongoDB Connection
const client = new MongoClient(process.env.MONGODB_URI);

export async function connectToMongoDB() {
  try {
    await client.connect();
    console.log("You successfully connected to MongoDB!");
    return client;
  } 
  catch (err) {
    console.dir(err);
  }
}

const connectedClient = await connectToMongoDB();
const database = connectedClient.db("mentorlagbe");
const usersCollection = database.collection("user");
const tuitionsCollection = database.collection("tuitions");
const applicationsCollection = database.collection("applications");
const savedTuitionsCollection = database.collection("savedTuitions");

// Get users 
app.get('/users', async (req, res) => {
    const cursor = usersCollection.find({});
    const result = await cursor.toArray();
    res.send(result);
})

// Mentor related APIs : My Tuitions
app.get('/my-tuitions', async (req, res) => {
    try{
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({
                error: "Email is required"
            })
        }
        const myTuitions = await tuitionsCollection
        .find({ tutorEmail: email })
        .sort({ createdAt: -1 })
        .toArray();

        res.status(200).json(myTuitions);
    }
    catch (error){
        console.error("Error fetching my tuitions:", error);
        res.status(500).json({
            error: "Failed to fetch my tuitions",
        });
    }

});

// Mentor related APIs : My Applicants
app.get('/applicants', async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({
                error: "Email is required"
            });
        }

        const myApplicants = await applicationsCollection
            .find({ tutorEmail: email })
            .sort({ appliedAt: -1 })
            .toArray();

        res.status(200).json(myApplicants);
    }
    catch (error) {
        console.error("Error fetching my applicants:", error);

        res.status(500).json({
            error: "Failed to fetch my applicants",
        });
    }
});

// Mentor related APIs: Add a New Tuition
app.post("/tuitions", async (req, res) => {
    try {
        const newTuition = {
            ...req.body,

            // Default values
            approvalStatus: "pending",
            isActive: true,

            // Creation date
            createdAt: new Date(),
        };

        const result = await tuitionsCollection.insertOne(newTuition);

        res.status(201).json({
            success: true,
            message: "Tuition posted successfully",
            insertedId: result.insertedId,
        });

    } catch (error) {
        console.error("Error posting tuition:", error);

        res.status(500).json({
            success: false,
            message: "Failed to post tuition",
        });
    }
});




// Student related APIs : My Applications
app.get('/my-applications', async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({
                error: "Email is required"
            });
        }

        const myApplications = await applicationsCollection
            .find({ studentEmail: email })
            .sort({ appliedAt: -1 })
            .toArray();

        res.status(200).json(myApplications);
    }
    catch (error) {
        console.error("Error fetching my applications:", error);

        res.status(500).json({
            error: "Failed to fetch my applications",
        });
    }
});

// Student related APIs : My Saved Tuitions
app.get('/saved-tuitions', async (req, res) => {
    try {
        const email = req.query.email;

        if (!email) {
            return res.status(400).json({
                error: "Email is required"
            });
        }

        const savedTuitions = await savedTuitionsCollection
            .find({ studentEmail: email })
            .sort({ savedAt: -1 })
            .toArray();

        res.status(200).json(savedTuitions);
    }
    catch (error) {
        console.error("Error fetching saved tuitions:", error);

        res.status(500).json({
            error: "Failed to fetch saved tuitions",
        });
    }
});

app.get("/", (req, res) => {
  res.send("MentorLagbe server is running");
});

// Start Server
app.listen(process.env.PORT || 8000, () => {
  console.log(`MentorLagbe server is running on port ${PORT}`);
});

// Export Express App for Vercel
export default app;