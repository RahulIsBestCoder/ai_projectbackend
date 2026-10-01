const { MongoClient } = require("mongodb");
async function run() {
    try {
        const client = await MongoClient.connect("mongodb://127.0.0.1:27017/ai_project");
        const db = client.db();
        const project = await db.collection("projects").findOne({ name: { $regex: /Mgroc demo 1/i } });
        if (!project) {
            console.log("Project not found");
            process.exit(1);
        }
        console.log(project._id.toString());
        await client.close();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
