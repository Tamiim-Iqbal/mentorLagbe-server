import express from "express";
import cors from "cors";
import "dotenv/config";
import { MongoClient, ObjectId } from "mongodb";
import Stripe from "stripe";
import { createRemoteJWKSet, jwtVerify } from "jose";

const app = express();
const PORT = process.env.PORT || 8000;
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

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

// JWKS Configuration (Outside Middleware)
const JWKS = createRemoteJWKSet(
    new URL(`${process.env.AUTH_URL}/api/auth/jwks`)
);

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    // Check Authorization Header
    if (!authHeader?.startsWith("Bearer ")) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized access. Please log in.",
        });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "Unauthorized access. Please log in.",
        });
    }

    try {
        const { payload } = await jwtVerify(token, JWKS);

        // Attach verified user information
        req.user = payload;

        next();
    } catch (error) {
        console.error("Token verification error:", error.message);

        return res.status(401).json({
            success: false,
            message: "Unauthorized access. Invalid or expired token.",
        });
    }
};

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
const transactionsCollection = database.collection("transactions");

// Prevent duplicate Stripe Checkout Sessions
await transactionsCollection.createIndex(
    { sessionId: 1 },
    { unique: true }
);

// Verify Admin Middleware
const verifyAdmin = async (req, res, next) => {
    try {
        const email = req.user?.email?.toLowerCase().trim();

        if (!email) {
            return res.status(403).json({
                success: false,
                message: "Admin access denied.",
            });
        }

        const user = await usersCollection.findOne({
            email,
        });

        if (!user || user.userRole !== "admin") {
            return res.status(403).json({
                success: false,
                message: "Admin access denied.",
            });
        }

        next();
    } catch (error) {
        console.error("Admin verification error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to verify admin access.",
        });
    }
};

// Get users 
app.get('/users', verifyToken, verifyAdmin, async (req, res) => {
    const cursor = usersCollection.find({});
    const result = await cursor.toArray();
    res.send(result);
})

// Escape special regex characters
const escapeRegex = (value) => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

// Get all transactions (Admin)
app.get("/admin/transactions", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(
            50,
            Math.max(1, Number(req.query.limit) || 10)
        );

        const search = String(req.query.search || "").trim();

        const skip = (page - 1) * limit;

        // Search filter
        const filter = {};

        if (search) {
            const searchRegex = new RegExp(
                escapeRegex(search),
                "i"
            );

            filter.$or = [
                { userEmail: searchRegex },
                { sessionId: searchRegex },
                { subscriptionId: searchRegex },
                { role: searchRegex },
                { paymentStatus: searchRegex },
                { currency: searchRegex },
            ];
        }

        // Get total count
        const total = await transactionsCollection.countDocuments(
            filter
        );

        // Get transactions with user information
        const transactions = await transactionsCollection.aggregate([
            {
                $match: filter,
            },
            {
                $sort: {
                    createdAt: -1,
                },
            },
            {
                $skip: skip,
            },
            {
                $limit: limit,
            },
            {
                $lookup: {
                    from: "user",
                    localField: "userEmail",
                    foreignField: "email",
                    as: "user",
                },
            },
            {
                $unwind: {
                    path: "$user",
                    preserveNullAndEmptyArrays: true,
                },
            },
            {
                $project: {
                    sessionId: 1,
                    userId: 1,
                    userEmail: 1,
                    userName: {
                        $ifNull: [
                            "$user.name",
                            "Unknown User",
                        ],
                    },
                    role: 1,
                    amount: 1,
                    currency: 1,
                    paymentStatus: 1,
                    sessionStatus: 1,
                    subscriptionId: 1,
                    createdAt: 1,
                },
            },
        ]).toArray();

        return res.status(200).json({
            success: true,
            data: transactions,
            pagination: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
            },
        });

    } catch (error) {
        console.error("Get transactions error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch transactions.",
        });
    }
});

// Payment Related APIs: Save Payment Transaction and Activate PRO Membership
app.post("/payments", verifyToken, async (req, res) => {
    try {
        const { sessionId } = req.body;
        const userEmail = req.user.email.toLowerCase().trim();

        // 1. Validate request
        if (
            typeof sessionId !== "string" ||
            !sessionId.trim()
        ) {
            return res.status(400).json({
                success: false,
                message: "Session ID is required.",
            });
        }

        // 2. Retrieve Stripe Checkout Session
        const session =
            await stripe.checkout.sessions.retrieve(sessionId);

        const {
            id,
            status,
            payment_status,
            customer_email,
            customer_details,
            metadata,
            payment_intent,
            subscription,
            customer,
            amount_total,
            currency,
            mode,
        } = session;

        // 3. Verify payment
        if (
            status !== "complete" ||
            payment_status !== "paid" ||
            mode !== "subscription"
        ) {
            return res.status(400).json({
                success: false,
                message: "Payment has not been completed.",
            });
        }

        // 4. Get userId from Stripe metadata
        const userId = metadata?.userId;

        if (!userId) {
            console.error(
                "Missing userId in Stripe metadata:",
                metadata
            );

            return res.status(400).json({
                success: false,
                message:
                    "User ID is missing from Stripe session metadata. Please create a new checkout session.",
            });
        }

        // 5. Verify email ownership
        const sessionEmail = (
            metadata?.email ||
            customer_details?.email ||
            customer_email ||
            ""
        ).toLowerCase().trim();

        if (!sessionEmail || sessionEmail !== userEmail) {
            return res.status(403).json({
                success: false,
                message: "Payment session does not belong to this user.",
            });
        }

        // 6. Verify role
        const role = metadata?.role;

        if (role !== "student" && role !== "mentor") {
            return res.status(400).json({
                success: false,
                message: "Invalid subscription role.",
            });
        }

        // 7. Find user
        const user = await usersCollection.findOne({
            email: userEmail,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        // 8. Verify user's role
        if (user.userRole !== role) {
            return res.status(403).json({
                success: false,
                message:
                    "Subscription role does not match your account.",
            });
        }

        // 9. Verify Better Auth user ID if available
        if (user.id && user.id !== userId) {
            return res.status(403).json({
                success: false,
                message: "User ID does not match your account.",
            });
        }

        // 10. Prepare transaction data
        const transaction = {
            sessionId: id,
            userEmail,
            role,

            amount: amount_total,
            currency,

            paymentStatus: payment_status,
            sessionStatus: status,

            paymentIntent:
                typeof payment_intent === "string"
                    ? payment_intent
                    : payment_intent?.id || null,

            subscriptionId:
                typeof subscription === "string"
                    ? subscription
                    : subscription?.id || null,

            customerId:
                typeof customer === "string"
                    ? customer
                    : customer?.id || null,

            createdAt: new Date(),
        };

        // 11. Save transaction and ensure userId is updated
        const result = await transactionsCollection.updateOne(
            { sessionId: id },
            {
                $set: {
                    userId,
                },
                $setOnInsert: transaction,
            },
            { upsert: true }
        );

        // 12. Activate PRO membership
        const updateResult = await usersCollection.updateOne(
            { email: userEmail },
            {
                $set: {
                    isPro: true,
                    stripeCustomerId: transaction.customerId,
                    stripeSubscriptionId: transaction.subscriptionId,
                    updatedAt: new Date(),
                },
            }
        );

        if (updateResult.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Unable to update user membership.",
            });
        }

        // 13. Get saved transaction
        const savedTransaction =
            await transactionsCollection.findOne({
                sessionId: id,
            });

        // 14. Success response
        return res.status(200).json({
            success: true,
            message:
                "Payment verified successfully. PRO membership activated.",
            transactionId: savedTransaction?._id,
            userId: savedTransaction?.userId,
            membership:
                role === "student" ? "PRO Student" : "PRO Mentor",
            alreadyProcessed: result.upsertedCount === 0,
        });

    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({
                success: false,
                message: "This payment has already been processed.",
            });
        }

        console.error("Payment verification error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to verify payment.",
        });
    }
});


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

// Get Mentor Tuition Posting Limit
app.get("/tuitions/limit", verifyToken, async (req, res) => {
    try {
        const email = req.user?.email?.toLowerCase().trim();

        if (!email) {
            return res.status(401).json({
                success: false,
                message: "Invalid authentication token. Email not found.",
            });
        }

        const user = await usersCollection.findOne({ email });

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
app.get('/my-tuitions', verifyToken, async (req, res) => {
    try {
        const email = req.user.email.toLowerCase().trim();

        const myTuitions = await tuitionsCollection
            .find({ tutorEmail: email })
            .sort({ createdAt: -1 })
            .toArray();

        res.status(200).json(myTuitions);
    }
    catch (error) {
        console.error("Error fetching my tuitions:", error);

        res.status(500).json({
            error: "Failed to fetch my tuitions",
        });
    }
});

// Mentor related APIs : My Applicants
app.get('/applicants', verifyToken, async (req, res) => {
    try {
        const email = req.user.email.toLowerCase().trim();

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
app.post("/tuitions", verifyToken, async (req, res) => {
    try {
        const tutorEmail = req.user.email.toLowerCase().trim();

        // 1. Find user from database
        const user = await usersCollection.findOne({
            email: tutorEmail,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        // 2. Check Free plan limit
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

        // 3. Create new tuition
        const {
            approvalStatus,
            isActive,
            tutorEmail: ignoredTutorEmail,
            ...tuitionData
        } = req.body;

        const newTuition = {
            ...tuitionData,
            tutorEmail,
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

// Mentor: Update Applicant Status
app.patch("/applications/:id/status", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        const tutorEmail = req.user.email.toLowerCase().trim();

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

        // 3. Find Application
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

        // 4. Only Pending Applications Can Be Updated
        if (application.status !== "pending") {
            return res.status(409).json({
                success: false,
                message: "This application has already been responded to.",
            });
        }

        // 5. Update Application Status
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

        // 6. Success Response
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
app.patch("/tuitions/:id/status", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { isActive } = req.body;
        const tutorEmail = req.user.email.toLowerCase().trim();

        // 1. Validate tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition ID.",
            });
        }

        // 2. Validate active status
        if (typeof isActive !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "A valid active status is required.",
            });
        }

        // 3. Update only the mentor's own tuition
        const result = await tuitionsCollection.updateOne(
            {
                _id: new ObjectId(id),
                tutorEmail,
            },
            {
                $set: {
                    isActive,
                    updatedAt: new Date(),
                },
            }
        );

        // 4. Check whether tuition exists and belongs to mentor
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
            isActive,
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
app.patch("/tuitions/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const tutorEmail = req.user.email.toLowerCase().trim();

        const {
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

        // 2. Validate Required Fields
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

        // 3. Find Tuition Owned by Tutor
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

        // 4. Update Editable Fields Only
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

        // 5. Update Tuition
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
app.delete("/tuitions/:id", verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const tutorEmail = req.user.email.toLowerCase().trim();

        // 1. Validate Tuition ID
        if (!ObjectId.isValid(id)) {
            return res.status(400).json({
                success: false,
                message: "Invalid tuition ID.",
            });
        }

        // 2. Find and delete tuition owned by this mentor
        const result = await tuitionsCollection.deleteOne({
            _id: new ObjectId(id),
            tutorEmail,
        });

        // 3. Tuition not found
        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: "Tuition not found or you are not authorized to delete it.",
            });
        }

        // 4. Delete related applications
        await applicationsCollection.deleteMany({
            tuitionId: id,
        });

        // 5. Success Response
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
app.get('/my-applications', verifyToken, async (req, res) => {
    try {
        const email = req.user.email.toLowerCase().trim();

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
app.get("/saved-tuitions", verifyToken, async (req, res) => {
    try {
        const studentEmail = req.user.email.toLowerCase().trim();

        const savedRecords = await savedTuitionsCollection
            .find({ studentEmail })
            .sort({ savedAt: -1 })
            .toArray();

        if (savedRecords.length === 0) {
            return res.status(200).json({
                success: true,
                tuitions: [],
            });
        }

        const tuitionIds = savedRecords.map(
            (item) => item.tuitionId
        );

        const tuitionDocuments = await tuitionsCollection
            .find({
                _id: { $in: tuitionIds },
            })
            .toArray();

        // Preserve the user's saved order
        const tuitionMap = new Map(
            tuitionDocuments.map((tuition) => [
                tuition._id.toString(),
                tuition,
            ])
        );

        const savedTuitions = savedRecords
            .map((record) => {
                const tuition = tuitionMap.get(
                    record.tuitionId.toString()
                );

                if (!tuition) return null;

                return {
                    ...tuition,
                    savedAt: record.savedAt,
                };
            })
            .filter(Boolean);

        return res.status(200).json({
            success: true,
            tuitions: savedTuitions,
        });

    } catch (error) {
        console.error("Get saved tuitions error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to load saved tuitions.",
        });
    }
});

// Check whether a tuition is saved
app.get("/saved-tuitions/check", verifyToken, async (req, res) => {
    try {
        const { tuitionId } = req.query;
        const studentEmail = req.user.email.toLowerCase().trim();

        // 1. Validate Tuition ID
        if (
            typeof tuitionId !== "string" ||
            !ObjectId.isValid(tuitionId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid tuition ID is required.",
            });
        }

        // 2. Check Saved Tuition
        const savedTuition = await savedTuitionsCollection.findOne({
            studentEmail,
            tuitionId: new ObjectId(tuitionId),
        });

        // 3. Success Response
        res.status(200).json({
            success: true,
            isSaved: Boolean(savedTuition),
        });
    } catch (error) {
        console.error("Check saved tuition error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to check saved tuition.",
        });
    }
});

// Save a tuition
app.post("/saved-tuitions", verifyToken, async (req, res) => {
    try {
        const { tuitionId } = req.body;
        const email = req.user.email.toLowerCase().trim();

        // 1. Validate Tuition ID
        if (
            typeof tuitionId !== "string" ||
            !ObjectId.isValid(tuitionId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid tuition ID is required.",
            });
        }

        const objectId = new ObjectId(tuitionId);

        // 2. Find user from database
        const user = await usersCollection.findOne({
            email,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        // 3. Verify student role
        if (user.userRole !== "student") {
            return res.status(403).json({
                success: false,
                message: "Only students can save tuitions.",
            });
        }

        // 4. Check whether tuition is already saved
        const existingSavedTuition =
            await savedTuitionsCollection.findOne({
                studentEmail: email,
                tuitionId: objectId,
            });

        if (existingSavedTuition) {
            return res.status(200).json({
                success: true,
                message: "Tuition is already saved.",
            });
        }

        // 5. Check Free plan limit
        const isPro = user.isPro === true;

        if (!isPro) {
            const savedCount =
                await savedTuitionsCollection.countDocuments({
                    studentEmail: email,
                });

            if (savedCount >= 5) {
                return res.status(403).json({
                    success: false,
                    code: "SAVE_LIMIT_REACHED",
                    message:
                        "Free plan allows you to save up to 5 tuitions. Upgrade to Pro for unlimited saves.",
                });
            }
        }

        // 6. Save tuition
        await savedTuitionsCollection.insertOne({
            studentEmail: email,
            tuitionId: objectId,
            savedAt: new Date(),
        });

        return res.status(201).json({
            success: true,
            message: "Tuition saved successfully.",
        });

    } catch (error) {
        console.error("Save tuition error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to save tuition.",
        });
    }
});


// Remove a saved tuition
app.delete("/saved-tuitions", verifyToken, async (req, res) => {
    try {
        const { tuitionId } = req.body;
        const studentEmail = req.user.email.toLowerCase().trim();

        // 1. Validate Tuition ID
        if (
            typeof tuitionId !== "string" ||
            !ObjectId.isValid(tuitionId)
        ) {
            return res.status(400).json({
                success: false,
                message: "Valid tuition ID is required.",
            });
        }

        // 2. Remove Saved Tuition
        await savedTuitionsCollection.deleteOne({
            studentEmail,
            tuitionId: new ObjectId(tuitionId),
        });

        // 3. Success Response
        res.status(200).json({
            success: true,
            message: "Tuition removed successfully.",
        });
    } catch (error) {
        console.error("Remove saved tuition error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to remove saved tuition.",
        });
    }
});

// Student related APIs : Apply for Tuition
app.post("/applications", verifyToken, async (req, res) => {
    try {
        const { tuitionId } = req.body;
        const studentEmail = req.user.email.toLowerCase().trim();

        // 1. Find student from database
        const user = await usersCollection.findOne({
            email: studentEmail,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        // 2. Check Duplicate Application
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

        // 3. Check Free plan limit
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

        // 4. Create new application
        const newApplication = {
            ...req.body,
            studentEmail,
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
app.get("/applications/limit", verifyToken, async (req, res) => {
    try {
        const email = req.user.email.toLowerCase().trim();

        // 1. Find student from database
        const user = await usersCollection.findOne({
            email,
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User not found.",
            });
        }

        // 2. Count total applications
        const totalApplications =
            await applicationsCollection.countDocuments({
                studentEmail: email,
            });

        // 3. Check Pro membership
        const isPro = user.isPro === true;

        // 4. Success Response
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
app.get("/admin/users", verifyToken, verifyAdmin, async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page) || 1);

        const limit = Math.min(
            50,
            Math.max(1, Number(req.query.limit) || 10)
        );

        const search = req.query.search?.trim() || "";

        const skip = (page - 1) * limit;

        // Search Filter
        const filter = search
            ? {
                  $or: [
                      {
                          name: {
                              $regex: search.replace(
                                  /[.*+?^${}()|[\]\\]/g,
                                  "\\$&"
                              ),
                              $options: "i",
                          },
                      },
                      {
                          email: {
                              $regex: search.replace(
                                  /[.*+?^${}()|[\]\\]/g,
                                  "\\$&"
                              ),
                              $options: "i",
                          },
                      },
                  ],
              }
            : {};

        // Total Users
        const totalUsers = await usersCollection.countDocuments(filter);

        // Fetch Users
        const users = await usersCollection
            .find(filter, {
                projection: {
                    password: 0,
                    token: 0,
                    accessToken: 0,
                    refreshToken: 0,
                },
            })
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
app.patch("/admin/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
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
app.get("/admin/tuitions", verifyToken, verifyAdmin, async (req, res) => {
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
app.patch("/admin/tuitions/:id/approval", verifyToken, verifyAdmin, async (req, res) => {
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