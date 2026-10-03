require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const multer = require("multer");
const { put, del } = require("@vercel/blob");

const app = express();

const MONGODB_URI =
    process.env.MONGODB_URI ||
    "mongodb+srv://codewiththura_db_user:mRB3ENvkWDFrafNL@cluster0.86dzvye.mongodb.net/?appName=Cluster0";

const JWT_SECRET = process.env.JWT_SECRET || "thisissecretkey";
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Multer Configuration for Memory Storage ---
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5 MB file size limit
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith("image/")) {
            cb(null, true);
        } else {
            cb(new Error("Only image files are allowed"), false);
        }
    }
});

// --- Helper Functions for Vercel Blob Public Storage ---
const uploadToBlob = async (file, folder = "uploads") => {
    const ext = file.originalname.split(".").pop();
    const filename = `${folder}/${Date.now()}-${Math.random().toString(36).substring(2, 8)}.${ext}`;
    const blob = await put(filename, file.buffer, {
        access: "public",
        contentType: file.mimetype
    });
    return blob.url;
};

const deleteFromBlob = async (url) => {
    if (url && (url.includes("vercel-storage.com") || url.includes("blob.vercel-storage.com"))) {
        try {
            await del(url);
        } catch (err) {
            console.warn("Failed to delete blob from Vercel Storage:", err.message);
        }
    }
};

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        username: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        password: { type: String, required: true },
        bio: { type: String, default: "" },
        avatarUrl: { type: String, default: "" },
        image: { type: String, default: "" }
    },
    {
        timestamps: true
    }
);

// likesCount => number of like count
// isLiked => wherther logged user likes 
// isSaved => wherther logged user saves 
// likes => id Array of likeBy users
// savedBy => id Array of savedBy users

const postSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        body: { type: String, required: true },
        imageUrl: { type: String, default: "" },
        image: { type: String, default: "" },
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
        savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }]
    },
    {
        timestamps: true
    }
);

// Post -> Many Comments
// Comment -> User 
// user
// post
// body

const commentSchema = new mongoose.Schema(
    {
        post: { type: mongoose.Schema.Types.ObjectId, ref: "Post" },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        name: { type: String, default: "" },
        email: { type: String, default: "" },
        body: { type: String, required: true }
    }
)


const User = mongoose.model("User", userSchema);
const Post = mongoose.model("Post", postSchema);
const Comment = mongoose.model("Comment", commentSchema);

const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.json({ message: "Authentication required" })
        }
        const token = authHeader.split(" ")[1];
        console.log(token);
        const decoded = jwt.verify(token, JWT_SECRET);
        console.log(decoded);
        const user = await User.findById(decoded.userId);
        if (!user) {
            return res.json({ message: "User not found" })
        }

        req.user = user;
        next();
    } catch (err) {
        console.log(err);
        return res.json({ message: "Something went wrong!" })
    }
}

// Public & Authenticated နှစ်မျိုးလုံးအတွက် Optional Auth Middleware
const optionalAuthenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        // Token မပါလာရင် public user အဖြစ် သတ်မှတ်ပြီး ရှေ့ဆက်သွားမယ်
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            req.user = null;
            return next();
        }

        const token = authHeader.split(" ")[1];

        // Token ပါလာရင် verify လုပ်မယ်
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await User.findById(decoded.userId).select("-password");

        // User ရှိရင် req.user ထဲ ထည့်ပေးမယ်၊ မရှိရင် null
        req.user = user || null;
        next();
    } catch (err) {
        req.user = null;
        next();
    }
};

app.post("/auth/register", async (req, res) => {
    const { name, username, email, password, bio } = req.body;

    const userExists = await User.findOne({ email })

    if (userExists) {
        return res.status(400).json({ message: "Email already exists." })
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({ name, username, email, password: hashedPassword, bio })

    res.status(200).json(user);
})

app.post("/auth/login", async (req, res) => {
    const { name, username, email, password, bio } = req.body;
    const user = await User.findOne({ email });

    if (!user) {
        return res.status(400).json({ message: "Invalid email" })
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        return res.status(400).json({ message: "Invalid password" })
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
        expiresIn: "7d"
    })

    res.json({ token: token, user });
})

app.get("/auth/me", authenticate, async (req, res) => {
    const user = req.user
    res.json(user)
})

app.post("/auth/logout", async (req, res) => {
    return res.status(400).json({ message: "Loggged out successfully" })
})

// ----- USER ROUTES ----
app.post("/users", async (req, res) => {
    const users = await User.create({ name: req.body.name, email: req.body.email })
    res.json(users);
})

app.get("/users", async (req, res) => {
    if (req.query.name) {
        const users = await User.findOne({ name: req.query.name });
    }
    const users = await User.find({});
    res.json(users);
})

app.get("/users/:id", async (req, res) => {
    const user = await User.findById(req.params.id);
    res.json(user);
})

app.put("/users/:id", async (req, res) => {
    const name = req.body.name;
    const email = req.body.email;
    const user = await User.findByIdAndUpdate(req.params.id, {
        name,
        email
    });
    res.json(user);
})

app.delete("/users/:id", async (req, res) => {
    const user = await User.findByIdAndDelete(req.params.id);
    if (user) {
        await deleteFromBlob(user.avatarUrl || user.image);
    }
    res.json(user);
})

// Upload / Update user profile image (Vercel Blob Public)
const handleUserImageUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No image file provided" });
        }

        // Only the account owner can update their image
        if (req.user._id.toString() !== req.params.id) {
            return res.status(403).json({ message: "Unauthorized to update this user's image" });
        }

        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        // Upload to Vercel Blob public storage
        const imageUrl = await uploadToBlob(req.file, "users");

        // Clean up previous avatar if stored on Vercel
        await deleteFromBlob(user.avatarUrl || user.image);

        user.avatarUrl = imageUrl;
        user.image = imageUrl;
        await user.save();

        res.json({ message: "User image uploaded successfully", user, imageUrl });
    } catch (err) {
        console.error("User image upload error:", err);
        res.status(500).json({ message: err.message || "Failed to upload user image" });
    }
};

app.put("/users/:id/image", authenticate, upload.single("image"), handleUserImageUpload);
app.put("/users/:id/avatar", authenticate, upload.single("avatar"), handleUserImageUpload);


// -----POST ROUTES-----

// Create a post (supports optional single image upload in the same request)
app.post("/posts", authenticate, upload.single("image"), async (req, res) => {
    try {
        const { title, body } = req.body;
        const authorId = req.user ? req.user._id : req.body.userId;

        let imageUrl = req.body.imageUrl || req.body.image || "";

        // If a single image file is uploaded
        if (req.file) {
            imageUrl = await uploadToBlob(req.file, "posts");
        }

        const post = await Post.create({
            title,
            body,
            imageUrl,
            image: imageUrl,
            author: authorId,
            likes: [],
            savedBy: []
        });

        res.status(201).json(post);
    } catch (err) {
        console.error("Create post error:", err);
        res.status(500).json({ message: err.message || "Failed to create post" });
    }
});

// Upload single image for a specific post (supports field names 'image' and 'photo')
const handlePostImageUpload = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: "No image file provided" });
        }

        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        // Only author can update post image
        if (post.author.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Unauthorized to update this post's image" });
        }

        const imageUrl = await uploadToBlob(req.file, "posts");

        // Clean up previous image if exists on Vercel storage
        await deleteFromBlob(post.imageUrl || post.image);

        post.imageUrl = imageUrl;
        post.image = imageUrl;
        await post.save();

        res.json({ message: "Post image uploaded successfully", post, imageUrl });
    } catch (err) {
        console.error("Post image upload error:", err);
        res.status(500).json({ message: err.message || "Failed to upload post image" });
    }
};

app.post("/posts/:id/image", authenticate, upload.single("image"), handlePostImageUpload);
app.post("/posts/:id/photo", authenticate, upload.single("photo"), handlePostImageUpload);

app.get("/posts", optionalAuthenticate, async (req, res) => {
    const posts = await Post.find({})
        .populate("author", "name username email avatarUrl image")
        .lean();

    const formattedPosts = posts.map((post) => ({
        ...post,
        likesCount: post.likes ? post.likes.length : 0,
        isLiked: req.user ? post.likes.some((id) => id.toString() === req.user._id.toString()) : false,
        isSaved: req.user ? post.savedBy.some((id) => id.toString() === req.user._id.toString()) : false,
    }));


    res.json(formattedPosts);
})

app.get("/posts/:id", async (req, res) => {
    const post = await Post.findById(req.params.id).populate("author", "name username email avatarUrl image");
    res.json(post);
})

app.put("/posts/:id", authenticate, upload.fields([{ name: "image", maxCount: 1 }, { name: "photo", maxCount: 1 }]), async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        if (post.author.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Unauthorized to update this post" });
        }

        const updateData = {};
        if (req.body.title !== undefined) updateData.title = req.body.title;
        if (req.body.body !== undefined) updateData.body = req.body.body;

        // Allow updating imageUrl via JSON string
        const incomingUrl = req.body.imageUrl !== undefined ? req.body.imageUrl : req.body.image;
        if (incomingUrl !== undefined) {
            updateData.imageUrl = incomingUrl;
            updateData.image = incomingUrl;
        }

        // Allow updating image via file upload ('image' or 'photo' field)
        const uploadedFile = req.files?.image?.[0] || req.files?.photo?.[0] || req.file;
        if (uploadedFile) {
            const imageUrl = await uploadToBlob(uploadedFile, "posts");
            await deleteFromBlob(post.imageUrl || post.image);
            updateData.imageUrl = imageUrl;
            updateData.image = imageUrl;
        }

        const updatedPost = await Post.findByIdAndUpdate(req.params.id, updateData, { new: true });
        res.json(updatedPost);
    } catch (err) {
        res.status(500).json({ message: err.message || "Failed to update post" });
    }
})

app.delete("/posts/:id", authenticate, async (req, res) => {
    try {
        const post = await Post.findById(req.params.id);
        if (!post) {
            return res.status(404).json({ message: "Post not found" });
        }

        if (post.author.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: "Unauthorized to delete this post" });
        }

        await deleteFromBlob(post.imageUrl || post.image);
        await Post.findByIdAndDelete(req.params.id);
        res.json({ message: "Post and image deleted successfully" });
    } catch (err) {
        res.status(500).json({ message: err.message || "Failed to delete post" });
    }
})

app.post("/posts/:id/like", authenticate, async (req, res) => {
    const post = await Post.findById(req.params.id);
    if (!post) {
        return res.json({ message: "Post not found" })
    }
    const currentUserId = req.user._id.toString();
    const index = post.likes.findIndex((id) => id.toString() === currentUserId);

    let isLiked = false;
    if (index > -1) {
        post.likes.splice(index, 1);
        isLiked = false;
    } else {
        post.likes.push(req.user._id);
        isLiked = true;
    }

    await post.save();
    // [1,3,5] -> index (0,1,..) , -1
    // 6

    // toggle -> like -> unlike -> liked
    res.json({ ...post.toObject(), isLiked, likesCount: post.likes.length });
})

app.post("/posts/:id/save", authenticate, async (req, res) => {
    const post = await Post.findById(req.params.id);
    if (!post) {
        return res.json({ message: "Post not found" })
    }
    const currentUserId = req.user._id.toString();
    const index = post.savedBy.findIndex((id) => id.toString() === currentUserId);

    let isSaved = false;
    if (index > -1) {
        post.savedBy.splice(index, 1);
        isSaved = false;
    } else {
        post.savedBy.push(req.user._id);
        isSaved = true;
    }

    await post.save();
    // [1,3,5] -> index (0,1,..) , -1
    // 6

    // toggle -> like -> unlike -> liked
    res.json({ ...post.toObject(), isSaved, likesCount: post.likes.length });
})

// --- Comment Routes ---

app.get("/posts/:postId/comments", async (req, res) => {
    const comments = await Comment.find({ post: req.params.postId }).populate("user", "name username email");
    res.json(comments);
})

app.post("/posts/:postId/comments", authenticate, async (req, res) => {
    const { body } = req.body;
    if (!body) {
        return res.json({ message: "Comment is required" })
    }

    const comment = await Comment.create({ body: body, post: req.params.postId, user: req.user._id, name: req.user.name, email: req.user.email });

    res.json(comment);
})




mongoose
    .connect(MONGODB_URI)
    .then(() => {
        app.listen(3000, () => {
            console.log("Server started on port 3000");
        });
    })
    .catch((err) => console.error(err));
