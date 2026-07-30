const fs = require('fs');
let code = fs.readFileSync('src/app/api/agent/route.ts', 'utf8');

// Replace guided_start
const oldStart = code.indexOf("// ═══ GUIDED START");
const oldEval = code.indexOf("// ═══ GUIDED EVALUATE");
const before = code.substring(0, oldStart);
const after = code.substring(oldEval);

const newStart = `// ═══ GUIDED START ═══
    if (action === "guided_start") {
      const { question } = params;
      const text = await callQwen([
        { role: "system", content: "你是《基础设施规划》课程的引导式AI助教。规则：1.不要直接给答案，用提问引导学生思考 2.每次只问一个引导问题 3.用课程案例辅助 4.语气亲切鼓励" },
        { role: "user", content: "学生问：" + (question||"") + " 请简短回应学生的困惑(1-2句)，然后提出一个引导性提问帮助学生自己思考。不要直接给答案。" },
      ], 512);
      return NextResponse.json({ greeting: text });
    }

    // ═══ GUIDED EVALUATE ═══`;

code = before + newStart + after;

// Replace guided_hint
const oldHint = code.indexOf("// ═══ GUIDED HINT");
const oldNext = code.indexOf("// ═══ SANDBOX");
const before2 = code.substring(0, oldHint);
const after2 = code.substring(oldNext);

const newHint = `// ═══ GUIDED HINT ═══
    if (action === "guided_hint") {
      const { question, hintsUsed, conversation } = params;
      const level = (hintsUsed || 0) + 1;
      const text = await callQwen([
        { role: "system", content: "引导式AI助教。级别提示：" + level + "级。1=方向，2=思路，3=步骤，4=接近答案。" },
        { role: "user", content: "对话：" + (conversation||"") + " 问题：" + (question||"") + " 给第" + level + "级提示。" },
      ], 256);
      return NextResponse.json({ hint: text });
    }

    // ═══ SANDBOX ═══`;

code = before2 + newHint + after2;

fs.writeFileSync('src/app/api/agent/route.ts', code);
console.log('GUIDED_FIXED');
