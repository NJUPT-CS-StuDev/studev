# Rule parity

The small amount of rule code both clients need has one reference: the TypeScript in
`src/campus`. [`generate.ts`](generate.ts) runs it on the packaged release and freezes
inputs and answers in [`golden.json`](golden.json); `parity.test.tsx` and Android's
`ParityTest` both read that file, so a rule changed on one side fails on the other.

It covers the timetable cells of three real classes, events on chosen days (holidays,
运动会, 早锻炼), what comes next, the week a "now" view shows, where teaching ends,
where a lesson off its week next meets, each timetable's course tones, room states,
opening hours, map recommendations and exam reminders.

Regenerate after `npm run digest`, then review the diff:

```powershell
./node_modules/.bin/esbuild src/campus/world/parity/generate.ts --bundle --platform=node --format=esm --packages=external --alias:@=./src/campus --loader:.json=json --outfile=D:/Temp/claude-wsl/parity/generate.mjs
node D:/Temp/claude-wsl/parity/generate.mjs
npm run test:campus
./android/gradlew.bat -p android testDebugUnitTest
```
