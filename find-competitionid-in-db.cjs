const { createClient } = require("@supabase/supabase-js");

const { exec } = require("child_process");
const util = require("util");
const execAsync = util.promisify(exec);

async function checkForCompetitionidReferences() {
  console.log("Checking for any remaining competitionid references...\n");

  // Use Supabase CLI to get a dump of relevant objects
  try {
    const { stdout, stderr } = await execAsync(
      'npx supabase db dump --schema public --data-only=false | Select-String -Pattern "competitionid" -Context 0,2',
      { cwd: "C:\\Users\\maxmi\\GitHub\\theprize.io" },
    );

    console.log("Found references:\n");
    console.log(stdout);

    if (stderr) {
      console.error("Errors:", stderr);
    }
  } catch (error) {
    console.error("Command failed:", error.message);
  }
}

checkForCompetitionidReferences();
