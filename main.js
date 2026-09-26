const express = require("express");
const mongoose = require("mongoose");

const app = express();

const MONGODB_URI =
    "mongodb+srv://codewiththura_db_user:mRB3ENvkWDFrafNL@cluster0.86dzvye.mongodb.net/?appName=Cluster0";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));


const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, required: true, unique: true },
        date: { type: Date, default: Date.now },
        bio: { type: String, default: "" }
    },
    {
        timestamps: true
    }
);

const postSchema = new mongoose.Schema(
    {
        title: { type: String, required: true },
        body: { type: String, required: true },
        author: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        }
    },
    {
        timestamps: true
    }
);


const User = mongoose.model("User", userSchema);
const Post = mongoose.model("Post", postSchema);

app.post("/users", async (req, res) => {
    const users = await User.create({ name: req.body.name, email: req.body.email })
    res.json({ data: users });
})

app.get("/users", async (req, res) => {
    if (req.query.name) {
        const users = await User.findOne({ name: req.query.name });
    }
    const users = await User.find({});
    res.json({ data: users });
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
    res.json(user);
})

app.post("/posts", async (req, res) => {
    console.log(req.body.title, req.body.content, req.body.userId);
    const users = await Post.create({ title: req.body.title, body: req.body.content, author: req.body.userId })
    res.json({ data: users });
})


mongoose
    .connect(MONGODB_URI)
    .then(() => {
        app.listen(3000, () => {
            console.log("Server started on port 3000");
        });
    })
    .catch((err) => console.error(err));
