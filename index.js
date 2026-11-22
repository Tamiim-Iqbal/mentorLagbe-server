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
            .sort({ updatedAt: -1 })
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
            .sort({ updatedAt: -1 })
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

        // 1. Validate Tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition ID.",
            });
        }

        // 2. Find Tuition by ID
        const tuition = await tuitionsCollection.findOne({
            _id: new ObjectId(id),
        });

        // 3. Tuition Not Found
        if (!tuition) {
            return res.status(404).json({
                success: false,
                message: "Tuition not found.",
            });
        }

        // 4. Check Approval Status
        if (tuition.approvalStatus !== "approved") {
            return res.status(403).json({
                success: false,
                message: "This tuition is not approved yet.",
            });
        }

        // 5. Check Active Status
        if (tuition.isActive !== true) {
            return res.status(403).json({
                success: false,
                message: "This tuition is currently inactive.",
            });
        }

        // 6. Success Response
        return res.status(200).json({
            success: true,
            message: "Tuition details fetched successfully.",
            tuition,
        });

    } catch (error) {
        console.error("Error fetching tuition details:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch tuition details.",
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
        const {
            approvalStatus,
            isActive,
            ...tuitionData
        } = req.body;

        const newTuition = {
            ...tuitionData,
            approvalStatus: "pending",
            isActive: true,
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

// Mentor related APIs: Update Tuition Active Status
app.patch("/tuitions/:id/status", async (req, res) => {
    try {
        const { id } = req.params;
        const { tutorEmail, isActive } = req.body;

        // 1. Validate tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition ID.",
            });
        }

        // 2. Validate mentor email
        if (!tutorEmail) {
            return res.status(400).json({
                success: false,
                message: "Mentor email is required.",
            });
        }

        // 3. Validate active status
        if (typeof isActive !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "A valid active status is required.",
            });
        }

        // 4. Update only the mentor's own tuition
        const result = await tuitionsCollection.updateOne(
            {
                _id: new ObjectId(id),
                tutorEmail: tutorEmail,
            },
            {
                $set: {
                    isActive: isActive,
                    updatedAt: new Date(),
                },
            }
        );

        // 5. Check whether tuition exists and belongs to mentor
        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Tuition not found.",
            });
        }

        return res.status(200).json({
            success: true,
            message: `Tuition ${isActive ? "activated" : "closed"} successfully.`,
            tuitionId: id,
            isActive: isActive,
        });
    } catch (error) {
        console.error("Update tuition status error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update tuition status.",
        });
    }
});


// Mentor related APIs : Update Tuition
app.patch("/tuitions/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const {
            tutorEmail,
            title,
            subject,
            classLevel,
            mode,
            location,
            monthlyFee,
            daysPerWeek,
            bannerImage,
            description,
        } = req.body;

        // 1. Validate Tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition ID.",
            });
        }

        // 2. Validate Tutor Email
        if (!tutorEmail) {
            return res.status(400).json({
                success: false,
                message: "Tutor email is required.",
            });
        }

        // 3. Validate Required Fields
        if (
            !title?.trim() ||
            title.trim().length > 120 ||
            !subject ||
            !classLevel ||
            !["Online", "Offline"].includes(mode) ||
            !Number.isFinite(Number(monthlyFee)) ||
            Number(monthlyFee) <= 0 ||
            !Number.isInteger(Number(daysPerWeek)) ||
            Number(daysPerWeek) < 1 ||
            Number(daysPerWeek) > 7 ||
            !description?.trim() ||
            description.trim().length < 10 ||
            (mode === "Offline" && !location?.trim())
        ) {
            return res.status(400).json({
                success: false,
                message: "Please provide valid tuition details.",
            });
        }

        // 4. Find Tuition Owned by Tutor
        const tuition = await tuitionsCollection.findOne({
            _id: new ObjectId(id),
            tutorEmail,
        });

        if (!tuition) {
            return res.status(404).json({
                success: false,
                message: "Tuition not found or you are not authorized to update it.",
            });
        }

        // 5. Update Editable Fields Only
        const updatedData = {
            title: title.trim(),
            subject,
            classLevel,
            mode,
            location: mode === "Online" ? "Online" : location.trim(),
            monthlyFee: Number(monthlyFee),
            daysPerWeek: Number(daysPerWeek),
            bannerImage: bannerImage || "",
            description: description.trim(),
            updatedAt: new Date(),
        };

        // 6. Update Tuition
        const result = await tuitionsCollection.updateOne(
            {
                _id: new ObjectId(id),
                tutorEmail,
            },
            {
                $set: updatedData,
            }
        );

        return res.status(200).json({
            success: true,
            message:
                result.modifiedCount > 0
                    ? "Tuition updated successfully."
                    : "No changes were made.",
        });
    } catch (error) {
        console.error("Error updating tuition:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to update tuition.",
        });
    }
});


// Mentor related APIs : Delete Tuition
app.delete("/tuitions/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { tutorEmail } = req.body;

        // 1. Validate Tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition ID.",
            });
        }

        // 2. Validate Mentor Email
        if (!tutorEmail) {
            return res.status(400).json({
                success: false,
                message: "Mentor email is required.",
            });
        }

        // 3. Find and delete tuition owned by this mentor
        const result = await tuitionsCollection.deleteOne({
            _id: new ObjectId(id),
            tutorEmail,
        });

        // 4. Tuition not found
        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Tuition not found or you are not authorized to delete it.",
            });
        }

        // 5. Delete related applications
        await applicationsCollection.deleteMany({
            tuitionId: id,
        });

        // 6. Success Response
        return res.status(200).json({
            success: true,
            message: "Tuition deleted successfully.",
            deletedTuitionId: id,
        });
    } catch (error) {
        console.error("Delete tuition error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to delete tuition.",
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

// Admin API: Get All Users
app.get("/admin/users", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(
            50,
            Math.max(1, Number(req.query.limit) || 10)
        );

        const skip = (page - 1) * limit;

        const totalUsers = await usersCollection.countDocuments();

        const users = await usersCollection
            .find(
                {},
                {
                    projection: {
                        password: 0,
                        token: 0,
                        accessToken: 0,
                        refreshToken: 0,
                    },
                }
            )
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        res.status(200).json({
            success: true,
            data: users,
            pagination: {
                totalUsers,
                currentPage: page,
                totalPages: Math.ceil(totalUsers / limit),
                limit,
            },
        });
    } catch (error) {
        console.error("Admin users error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch users.",
        });
    }
});


// Admin API: Update User Role
app.patch("/admin/users/:id/role", async (req, res) => {
    try {
        const { id } = req.params;
        const { userRole } = req.body;

        // Validate User ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user ID.",
            });
        }

        // Validate Role
        const allowedRoles = ["student", "mentor", "admin"];

        if (!allowedRoles.includes(userRole)) {
            return res.status(400).json({
                success: false,
                message: "Invalid user role.",
            });
        }

        // Check Existing User
        const existingUser = await usersCollection.findOne({
            _id: new ObjectId(id),
        });

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        const currentRole = existingUser.userRole || "student";

        // Check Same Role
        if (currentRole === userRole) {
            return res.status(400).json({
                success: false,
                message: "User already has this role.",
            });
        }

        // Update Role
        const result = await usersCollection.updateOne(
            { _id: new ObjectId(id) },
            {
                $set: {
                    userRole,
                    updatedAt: new Date(),
                },
            }
        );

        if (result.modifiedCount === 0) {
            return res.status(400).json({
                success: false,
                message: "Role was not changed.",
            });
        }

        res.status(200).json({
            success: true,
            message: "User role updated successfully.",
            data: {
                userId: id,
                previousRole: currentRole,
                newRole: userRole,
            },
        });
    } catch (error) {
        console.error("Update user role error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to update user role.",
        });
    }
});

// Admin API: Get All Tuitions
app.get("/admin/tuitions", async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);

        const limit = Math.min(
            50,
            Math.max(1, Number(req.query.limit) || 10)
        );

        const skip = (page - 1) * limit;

        const { status, search } = req.query;

        // Validate Approval Status
        const allowedStatuses = [
            "pending",
            "approved",
            "rejected",
        ];

        if (status && !allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition approval status.",
            });
        }

        // Build Query
        const query = {};

        if (status) {
            query.approvalStatus = status;
        }

        // Search Filter
        if (search && typeof search === "string" && search.trim()) {
            const escapedSearch = search.trim().replace(
                /[.*+?^${}()|[\]\\]/g,
                "\\$&"
            );

            const searchRegex = new RegExp(escapedSearch, "i");

            query.$or = [
                { title: searchRegex },
                { subject: searchRegex },
                { tutorName: searchRegex },
                { tutorEmail: searchRegex },
            ];
        }

        // Get Total Tuitions
        const totalTuitions =
            await tuitionsCollection.countDocuments(query);

        // Get Paginated Tuitions
        const tuitions = await tuitionsCollection
            .find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .toArray();

        // Response
        res.status(200).json({
            success: true,
            tuitions,
            pagination: {
                totalTuitions,
                currentPage: page,
                totalPages: Math.ceil(totalTuitions / limit),
                limit,
            },
        });
    } catch (error) {
        console.error("Admin get tuitions error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch tuitions.",
        });
    }
});

// Admin API: Update Tuition Approval
app.patch("/admin/tuitions/:id/approval", async (req, res) => {
    try {
        const { id } = req.params;
        const { approvalStatus } = req.body;

        // Validate Tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition ID.",
            });
        }

        // Validate Approval Status
        const allowedStatuses = [
            "pending",
            "approved",
            "rejected",
        ];

        if (!allowedStatuses.includes(approvalStatus)) {
            return res.status(400).json({
                success: false,
                message: "Invalid approval status.",
            });
        }

        const tuitionId = new ObjectId(id);

        // Find Existing Tuition
        const existingTuition = await tuitionsCollection.findOne({
            _id: tuitionId,
        });

        if (!existingTuition) {
            return res.status(404).json({
                success: false,
                message: "Tuition not found.",
            });
        }

        const previousStatus =
            existingTuition.approvalStatus || "pending";

        // Check Same Status
        if (previousStatus === approvalStatus) {
            return res.status(400).json({
                success: false,
                message: "Tuition already has this approval status.",
            });
        }

        // Update Approval Status
        const result = await tuitionsCollection.updateOne(
            {
                _id: tuitionId,
                approvalStatus: existingTuition.approvalStatus,
            },
            {
                $set: {
                    approvalStatus,
                    updatedAt: new Date(),
                },
            }
        );

        // Check Update Result
        if (result.modifiedCount === 0) {
            return res.status(409).json({
                success: false,
                message: "Tuition status changed. Please refresh and try again.",
            });
        }

        // Success Response
        res.status(200).json({
            success: true,
            message: "Tuition approval updated successfully.",
            data: {
                tuitionId: id,
                previousStatus,
                newStatus: approvalStatus,
            },
        });
    } catch (error) {
        console.error("Admin update tuition approval error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to update tuition approval.",
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