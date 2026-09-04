#!/usr/bin/env node
/**
 * Pick the next Android versionCode and write it everywhere it is read from.
 *
 * Play rejects a versionCode it has already accepted, and the number that
 * actually ships is the one in android/app/build.gradle — android/ is committed,
 * so CI builds it directly and never runs `expo prebuild`. app.json is kept in
 * sync anyway so that a later prebuild does not roll the number backwards.
 *
 * Takes the max of the two rather than trusting either, so a hand-edit to one
 * file can only ever push the number up.
 */
const fs = require('fs');
const path = require('path');

const appRoot = path.resolve(__dirname, '..');
const appJsonPath = path.join(appRoot, 'app.json');
const gradlePath = path.join(appRoot, 'android', 'app', 'build.gradle');

const appJson = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
const gradle = fs.readFileSync(gradlePath, 'utf8');

const gradleMatch = gradle.match(/versionCode\s+(\d+)/);
if (!gradleMatch) throw new Error(`no versionCode in ${gradlePath}`);

const current = Math.max(Number(gradleMatch[1]), Number(appJson.expo.android.versionCode ?? 0));
const next = current + 1;
const versionName = appJson.expo.version;

appJson.expo.android.versionCode = next;
fs.writeFileSync(appJsonPath, `${JSON.stringify(appJson, null, 2)}\n`);

fs.writeFileSync(
  gradlePath,
  gradle
    .replace(/versionCode\s+\d+/, `versionCode ${next}`)
    .replace(/versionName\s+"[^"]*"/, `versionName "${versionName}"`)
);

console.log(`versionCode ${current} -> ${next}  (versionName ${versionName})`);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `version_code=${next}\nversion_name=${versionName}\n`
  );
}
