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

// Home APIs : Get All Approved Tuitions
app.get("/tuitions", async (req, res) => {
    try {
        const allTuitions = await tuitionsCollection
            .find({
                approvalStatus: "approved",
                isActive: true,
            })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json(allTuitions);
    } catch (error) {
        console.error("Error fetching tuitions:", error);

        res.status(500).json({
            error: "Failed to fetch tuitions",
        });
    }
});

// Home APIs : Get Latest 6 Approved Tuitions
app.get("/tuitions/latest", async (req, res) => {
    try {
        const latestTuitions = await tuitionsCollection
            .find({
                approvalStatus: "approved",
                isActive: true,
            })
            .sort({ createdAt: -1 })
            .limit(6)
            .toArray();

        res.status(200).json(latestTuitions);
    } catch (error) {
        console.error("Error fetching latest tuitions:", error);

        res.status(500).json({
            error: "Failed to fetch latest tuitions",
        });
    }
});

// Home APIs : Get Tuition Details by ID
app.get("/tuitions/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                error: "Invalid tuition ID",
            });
        }

        const tuition = await tuitionsCollection.findOne({
            _id: new ObjectId(id),
            approvalStatus: "approved",
            isActive: true,
        });

        if (!tuition) {
            return res.status(404).json({
                error: "Tuition not found",
            });
        }

        res.status(200).json(tuition);
    } catch (error) {
        console.error("Error fetching tuition details:", error);

        res.status(500).json({
            error: "Failed to fetch tuition details",
        });
    }
});

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

// Mentor related APIs : Post Tuition
app.post("/tuitions", async (req, res) => {
    try {
        const { tutorEmail } = req.body;

        // 1. Check tutor email
        if (!tutorEmail) {
            return res.status(400).json({
                success: false,
                message: "Tutor email is required.",
            });
        }

        // 2. Find user from database
        const user = await usersCollection.findOne({
            email: tutorEmail,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        // 3. Check Free plan limit
        if (user.isPro !== true) {
            const totalPosts = await tuitionsCollection.countDocuments({
                tutorEmail,
            });

            if (totalPosts >= 2) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Free users can post a maximum of 2 tuitions. Upgrade to Pro for unlimited posts.",
                    limitReached: true,
                    currentPosts: totalPosts,
                    maxPosts: 2,
                });
            }
        }

        // 4. Create new tuition
        const newTuition = {
            ...req.body,
            createdAt: new Date(),
        };

        const result = await tuitionsCollection.insertOne(newTuition);

        return res.status(201).json({
            success: true,
            message: "Tuition posted successfully.",
            insertedId: result.insertedId,
        });

    } catch (error) {
        console.error("Error posting tuition:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to post tuition.",
        });
    }
});

// Get Mentor Tuition Posting Limit
app.get("/tuitions/limit/:email", async (req, res) => {
    try {
        const { email } = req.params;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Tutor email is required.",
            });
        }

        const user = await usersCollection.findOne({
            email,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        const totalPosts = await tuitionsCollection.countDocuments({
            tutorEmail: email,
        });

        const isPro = user.isPro === true;

        return res.status(200).json({
            success: true,
            totalPosts,
            maxPosts: isPro ? null : 2,
            isPro,
            isLimitReached: !isPro && totalPosts >= 2,
        });
    } catch (error) {
        console.error("Error fetching tuition limit:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch tuition limit.",
        });
    }
});

// Mentor: Update Applicant Status
app.patch("/applications/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { status, tutorEmail } = req.body;

        // 1. Validate Application ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid application ID.",
            });
        }

        // 2. Validate Status
        const allowedStatuses = ["accepted", "rejected"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid application status.",
            });
        }

        // 3. Validate Mentor Email
        if (!tutorEmail) {
            return res.status(400).json({
                success: false,
                message: "Mentor email is required.",
            });
        }

        // 4. Find Application
        const application = await applicationsCollection.findOne({
            _id: new ObjectId(id),
            tutorEmail,
        });

        if (!application) {
            return res.status(404).json({
                success: false,
                message: "Application not found.",
            });
        }

        // 5. Only Pending Applications Can Be Updated
        if (application.status !== "pending") {
            return res.status(409).json({
                success: false,
                message: "This application has already been responded to.",
            });
        }

        // 6. Update Application Status
        const result = await applicationsCollection.updateOne(
            {
                _id: new ObjectId(id),
                tutorEmail,
                status: "pending",
            },
            {
                $set: {
                    status,
                    respondedAt: new Date(),
                },
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(409).json({
                success: false,
                message: "Application status could not be updated.",
            });
        }

        // 7. Success Response
        return res.status(200).json({
            success: true,
            message: `Application ${status} successfully.`,
            applicationId: id,
            status,
        });
    } catch (error) {
        console.error("Update application status error:", error);

        return res.status(500).json({
            success: false,
            message: "Internal server error.",
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


// Student related APIs : Apply for Tuition
app.post("/applications", async (req, res) => {
    try {
        const { studentEmail, tuitionId } = req.body;

        // 1. Check student email
        if (!studentEmail) {
            return res.status(400).json({
                success: false,
                message: "Student email is required.",
            });
        }

        // 2. Find student from database
        const user = await usersCollection.findOne({
            email: studentEmail,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        // 3. Check Duplicate Application
        const existingApplication = await applicationsCollection.findOne({
            studentEmail,
            tuitionId,
        });

        if (existingApplication) {
            return res.status(409).json({
                success: false,
                message: "You have already applied for this tuition.",
                alreadyApplied: true,
            });
        }

        // 4. Check Free plan limit
        if (user.isPro !== true) {
            const totalApplications =
                await applicationsCollection.countDocuments({
                    studentEmail,
                });

            if (totalApplications >= 3) {
                return res.status(403).json({
                    success: false,
                    message:
                        "Free students can apply to a maximum of 3 tuitions. Upgrade to Pro for unlimited applications.",
                    limitReached: true,
                    currentApplications: totalApplications,
                    maxApplications: 3,
                });
            }
        }

        // 5. Create new application
        const newApplication = {
            ...req.body,
            status: "pending",
            appliedAt: new Date(),
        };

        const result = await applicationsCollection.insertOne(
            newApplication
        );

        return res.status(201).json({
            success: true,
            message: "Application submitted successfully.",
            insertedId: result.insertedId,
        });

    } catch (error) {
        console.error("Error submitting application:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to submit application.",
        });
    }
});


// Get Student Application Limit
app.get("/applications/limit/:email", async (req, res) => {
    try {
        const { email } = req.params;

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Student email is required.",
            });
        }

        const user = await usersCollection.findOne({
            email,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        const totalApplications =
            await applicationsCollection.countDocuments({
                studentEmail: email,
            });

        const isPro = user.isPro === true;

        return res.status(200).json({
            success: true,
            totalApplications,
            maxApplications: isPro ? null : 3,
            isPro,
            isLimitReached: !isPro && totalApplications >= 3,
        });

    } catch (error) {
        console.error("Error fetching application limit:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch application limit.",
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