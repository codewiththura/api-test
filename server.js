const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 5000;
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/social_app_db";
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret_key_123";

// 1. Ensure the upload directory exists
const uploadDir = path.join(__dirname, "uploads", "posts");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 2. Middlewares
app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

// 3. Simple Multer Setup for Post Images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/posts/");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `post-${req.params.id}${ext}`);
  },
});
const upload = multer({ storage });

// 4. Mongoose Schemas & Models
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    username: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    avatarUrl: { type: String, default: "" },
    bio: { type: String, default: "" },
  },
  { timestamps: true },
);

const postSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    body: { type: String, default: "" },
    imageUrl: { type: String, default: "" },
    author: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    savedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true },
);

const commentSchema = new mongoose.Schema(
  {
    post: { type: mongoose.Schema.Types.ObjectId, ref: "Post", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, default: "" },
    email: { type: String, default: "" },
    body: { type: String, required: true },
  },
  { timestamps: true },
);

const User = mongoose.model("User", userSchema);
const Post = mongoose.model("Post", postSchema);
const Comment = mongoose.model("Comment", commentSchema);

// 5. Authentication Middlewares
// Strict authentication for protected routes
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Authentication required" });
    }
    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};

// Optional user check for public feed views (to populate isLiked/isSaved)
const identifyUser = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    try {
      const token = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, JWT_SECRET);
      req.user = await User.findById(decoded.userId).select("-password");
    } catch {
      req.user = null;
    }
  }
  next();
};

// 6. Auth Routes
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, username, email, password, bio, avatarUrl } = req.body;
    if (!name || !username || !email || !password) {
      return res
        .status(400)
        .json({ message: "All required fields must be provided" });
    }

    const userExists = await User.findOne({ $or: [{ email }, { username }] });
    if (userExists) {
      return res
        .status(400)
        .json({ message: "Email or username already exists" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      username,
      email,
      password: hashedPassword,
      avatarUrl: avatarUrl || `https://i.pravatar.cc/150?u=${username}`,
      bio: bio || "",
    });

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: "7d",
    });
    const userObj = user.toObject();
    userObj.id = userObj._id.toString();
    delete userObj.password;

    res.status(201).json({ token, user: userObj });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Registration failed", error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const token = jwt.sign({ userId: user._id }, JWT_SECRET, {
      expiresIn: "7d",
    });
    const userObj = user.toObject();
    userObj.id = userObj._id.toString();
    delete userObj.password;

    res.json({ token, user: userObj });
  } catch (err) {
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

app.get("/api/auth/me", authenticate, (req, res) => {
  const userObj = req.user.toObject();
  userObj.id = userObj._id.toString();
  res.json(userObj);
});

app.post("/api/auth/logout", (req, res) => {
  res.json({ message: "Logged out successfully" });
});

// 7. Posts Routes (Direct inline calculation of isLiked, isSaved, and likesCount)
app.get("/api/posts", identifyUser, async (req, res) => {
  try {
    const filter = {};
    if (req.query.userId) {
      filter.author = req.query.userId;
    }

    const posts = await Post.find(filter)
      .populate("author", "name username avatarUrl bio")
      .sort({ createdAt: -1 });

    const currentUserId = req.user ? req.user._id.toString() : null;

    const result = posts.map((post) => {
      const p = post.toObject();
      p.id = p._id.toString();
      p.likesCount = post.likes ? post.likes.length : 0;
      p.isLiked = currentUserId
        ? post.likes.some((id) => id.toString() === currentUserId)
        : false;
      p.isSaved = currentUserId
        ? post.savedBy.some((id) => id.toString() === currentUserId)
        : false;
      return p;
    });

    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to retrieve posts", error: err.message });
  }
});

app.get("/api/posts/:id", identifyUser, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id).populate(
      "author",
      "name username avatarUrl bio",
    );
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const currentUserId = req.user ? req.user._id.toString() : null;
    const postObj = post.toObject();
    postObj.id = postObj._id.toString();
    postObj.likesCount = post.likes ? post.likes.length : 0;
    postObj.isLiked = currentUserId
      ? post.likes.some((id) => id.toString() === currentUserId)
      : false;
    postObj.isSaved = currentUserId
      ? post.savedBy.some((id) => id.toString() === currentUserId)
      : false;

    res.json(postObj);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to retrieve post", error: err.message });
  }
});

app.post("/api/posts", authenticate, async (req, res) => {
  try {
    const { title, body, content, imageUrl } = req.body;
    const post = await Post.create({
      title,
      body: body || content || "",
      imageUrl: imageUrl || "",
      author: req.user._id,
      likes: [],
      savedBy: [],
    });

    await post.populate("author", "name username avatarUrl bio");

    const postObj = post.toObject();
    postObj.id = postObj._id.toString();
    postObj.likesCount = 0;
    postObj.isLiked = false;
    postObj.isSaved = false;

    res.status(201).json(postObj);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to create post", error: err.message });
  }
});

app.put("/api/posts/:id", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (post.author.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Unauthorized to edit this post" });
    }

    const { title, body, content, imageUrl } = req.body;
    if (title !== undefined) post.title = title;
    if (body !== undefined) post.body = body;
    if (content !== undefined) post.body = content;
    if (imageUrl !== undefined) post.imageUrl = imageUrl;

    await post.save();
    await post.populate("author", "name username avatarUrl bio");

    const currentUserId = req.user._id.toString();
    const postObj = post.toObject();
    postObj.id = postObj._id.toString();
    postObj.likesCount = post.likes ? post.likes.length : 0;
    postObj.isLiked = post.likes.some((id) => id.toString() === currentUserId);
    postObj.isSaved = post.savedBy.some(
      (id) => id.toString() === currentUserId,
    );

    res.json(postObj);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to update post", error: err.message });
  }
});

app.delete("/api/posts/:id", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }
    if (post.author.toString() !== req.user._id.toString()) {
      return res
        .status(403)
        .json({ message: "Unauthorized to delete this post" });
    }

    await Comment.deleteMany({ post: post._id });
    await Post.findByIdAndDelete(req.params.id);

    res.json({ message: "Post and associated comments deleted" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to delete post", error: err.message });
  }
});

app.post("/api/posts/:id/like", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
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
    res.json({ isLiked, likesCount: post.likes.length });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to toggle like", error: err.message });
  }
});

app.post("/api/posts/:id/save", authenticate, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const currentUserId = req.user._id.toString();
    const index = post.savedBy.findIndex(
      (id) => id.toString() === currentUserId,
    );

    let isSaved = false;
    if (index > -1) {
      post.savedBy.splice(index, 1);
      isSaved = false;
    } else {
      post.savedBy.push(req.user._id);
      isSaved = true;
    }

    await post.save();
    res.json({ isSaved, postId: post._id });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to toggle save", error: err.message });
  }
});

// 8. Photo Upload Route
app.post("/api/posts/:id/photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: "No image file uploaded" });
    }

    const imageUrl = `/uploads/posts/${req.file.filename}`;
    const post = await Post.findByIdAndUpdate(
      req.params.id,
      { imageUrl },
      { new: true },
    ).populate("author", "name username avatarUrl bio");

    if (!post) {
      return res.status(404).json({ message: "Post not found" });
    }

    const postObj = post.toObject();
    postObj.id = postObj._id.toString();

    res.json({ imageUrl, post: postObj });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Photo upload failed", error: err.message });
  }
});

// 9. Comments Routes
app.get("/api/posts/:postId/comments", async (req, res) => {
  try {
    const comments = await Comment.find({ post: req.params.postId })
      .populate("user", "name username avatarUrl")
      .sort({ createdAt: 1 });

    const result = comments.map((c) => {
      const obj = c.toObject();
      obj.id = obj._id.toString();
      return obj;
    });

    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to retrieve comments", error: err.message });
  }
});

app.post("/api/posts/:postId/comments", authenticate, async (req, res) => {
  try {
    const { body, content } = req.body;
    const text = body || content;
    if (!text) {
      return res.status(400).json({ message: "Comment content is required" });
    }

    const comment = await Comment.create({
      post: req.params.postId,
      user: req.user._id,
      name: req.user.name,
      email: req.user.email,
      body: text,
    });

    await comment.populate("user", "name username avatarUrl");

    const commentObj = comment.toObject();
    commentObj.id = commentObj._id.toString();

    res.status(201).json(commentObj);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to create comment", error: err.message });
  }
});

// 10. Users Routes
app.get("/api/users", async (req, res) => {
  try {
    const users = await User.find().select("-password");
    const result = users.map((u) => {
      const obj = u.toObject();
      obj.id = obj._id.toString();
      return obj;
    });
    res.json(result);
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to retrieve users", error: err.message });
  }
});

app.get("/api/users/:id", async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select("-password");
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    const userObj = user.toObject();
    userObj.id = userObj._id.toString();
    res.json(userObj);
  } catch (err) {
    res.status(500).json({ message: "User lookup failed", error: err.message });
  }
});

// 11. Initial Database Seeder
const seedDatabase = async () => {
  const count = await User.countDocuments();
  if (count > 0) return;

  console.log("Seeding initial dummy data...");

  const dummyUsers = [
    {
      id: 1,
      name: "Thura",
      username: "thura",
      email: "thura@example.com",
      password: "password123",
      avatarUrl: "https://i.pravatar.cc/150?img=68",
      bio: "Passionate React & Node.js Developer.",
    },
    {
      id: 2,
      name: "May Thin",
      username: "maythin",
      email: "maythin@example.com",
      password: "password123",
      avatarUrl: "https://i.pravatar.cc/150?u=maythin",
      bio: "Frontend UI/UX enthusiast and technical writer.",
    },
    {
      id: 3,
      name: "Zaw Min",
      username: "zawmin",
      email: "zawmin@example.com",
      password: "password123",
      avatarUrl: "https://i.pravatar.cc/150?u=zawmin",
      bio: "Fullstack engineer passionate about clean architecture.",
    },
    {
      id: 4,
      name: "Hla Hla",
      username: "hlahla",
      email: "hlahla@example.com",
      password: "password123",
      avatarUrl: "https://i.pravatar.cc/150?u=hlahla",
      bio: "Mobile and Single Page Application enthusiast.",
    },
    {
      id: 5,
      name: "Kyaw Thu",
      username: "kyawthu",
      email: "kyawthu@example.com",
      password: "password123",
      avatarUrl: "https://i.pravatar.cc/150?u=kyawthu",
      bio: "Software Architect & Tech Instructor.",
    },
    {
      id: 6,
      name: "Su Su",
      username: "susu",
      email: "susu@example.com",
      password: "password123",
      avatarUrl: "https://i.pravatar.cc/150?u=susu",
      bio: "React and Next.js Frontend Developer.",
    },
  ];

  const dummyPosts = [
    {
      id: 1,
      userId: 1,
      title: "Getting Started with React",
      body: "React is a JavaScript library for building user interfaces.",
      imageUrl:
        "https://images.unsplash.com/photo-1633356122544-f134324a6cee?w=640",
      likes: [2, 3, 4, 5],
      savedBy: [2],
    },
    {
      id: 2,
      userId: 2,
      title: "Understanding useState Hook",
      body: "The useState hook lets you add state to functional components.",
      imageUrl:
        "https://images.unsplash.com/photo-1555066931-4365d14bab8c?w=640",
      likes: [1, 3, 4],
      savedBy: [1, 3],
    },
    {
      id: 3,
      userId: 3,
      title: "Props and Component Communication",
      body: "Props are the way components talk to each other in React. A parent component can pass data down to its children through props.",
      imageUrl:
        "https://images.unsplash.com/photo-1517694712202-14dd9538aa97?w=640",
      likes: [1, 2, 4, 6],
      savedBy: [2],
    },
    {
      id: 4,
      userId: 4,
      title: "React Router for Navigation",
      body: "React Router lets you handle navigation in a single page application with seamless client-side routing.",
      imageUrl:
        "https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=640",
      likes: [1, 2, 3, 5],
      savedBy: [1, 5],
    },
  ];

  const dummyComments = [
    {
      postId: 1,
      userId: 2,
      body: "This is a great introduction to React! Very helpful for beginners.",
    },
    {
      postId: 1,
      userId: 3,
      body: "I learned a lot from this post. Thanks for sharing!",
    },
  ];

  const userMap = {};
  for (const u of dummyUsers) {
    const hashedPassword = await bcrypt.hash(u.password, 10);
    const created = await User.create({
      name: u.name,
      username: u.username,
      email: u.email,
      password: hashedPassword,
      avatarUrl: u.avatarUrl,
      bio: u.bio,
    });
    userMap[u.id] = created;
  }

  const postMap = {};
  for (const p of dummyPosts) {
    const author = userMap[p.userId];
    const likes = p.likes.map((uid) => userMap[uid]._id);
    const savedBy = p.savedBy.map((uid) => userMap[uid]._id);
    const created = await Post.create({
      title: p.title,
      body: p.body,
      imageUrl: p.imageUrl,
      author: author._id,
      likes,
      savedBy,
    });
    postMap[p.id] = created;
  }

  for (const c of dummyComments) {
    const post = postMap[c.postId];
    const user = userMap[c.userId];
    if (post && user) {
      await Comment.create({
        post: post._id,
        user: user._id,
        name: user.name,
        email: user.email,
        body: c.body,
      });
    }
  }

  console.log("Dummy data seeding completed.");
};

// 12. Connect Database and Start Server
mongoose
  .connect(MONGODB_URI)
  .then(async () => {
    console.log("Successfully connected to MongoDB");
    await seedDatabase();
    app.listen(PORT, () => {
      console.log(`Backend server running on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database connection error:", err.message);
  });
