const { MongoClient } = require("mongodb");
async function run() {
    try {
        const client = await MongoClient.connect("mongodb://127.0.0.1:27017/ai_project");
        const db = client.db();
        const projects = await db.collection("projects").find({}).toArray();
        projects.forEach(p => console.log(p.name));
        await client.close();
    } catch (e) {
        console.error(e);
        process.exit(1);
    }
}
run();
