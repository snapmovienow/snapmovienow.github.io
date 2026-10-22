#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
snap_sms_sdk="${SNAP_SMS_SDK:?Set SNAP_SMS_SDK to an Android SDK}"
snap_sms_bt="${SNAP_SMS_BUILD_TOOLS:-$snap_sms_sdk/android-15}"
snap_sms_jar="${SNAP_SMS_ANDROID_JAR:-$snap_sms_sdk/android-35/android.jar}"
mkdir -p build/classes build/dex .signing
"$snap_sms_bt/aapt2" link -o build/base.apk --manifest AndroidManifest.xml -I "$snap_sms_jar"
python3 -c "from pathlib import Path; Path('build/sources.txt').write_text(''.join(str(p)+'\n' for p in Path('src').rglob('*.java')))"
java -m jdk.compiler/com.sun.tools.javac.Main -source 8 -target 8 -encoding UTF-8 -bootclasspath "$snap_sms_jar:$snap_sms_bt/core-lambda-stubs.jar" -d build/classes @build/sources.txt
python3 - <<'PY'
import pathlib,zipfile
with zipfile.ZipFile('build/classes.jar','w') as z:
 for p in pathlib.Path('build/classes').rglob('*.class'):z.write(p,p.relative_to('build/classes'))
PY
java -cp "$snap_sms_bt/lib/d8.jar" com.android.tools.r8.D8 --lib "$snap_sms_jar" --min-api 26 --output build/dex build/classes.jar
cp build/base.apk build/unsigned.apk
python3 - <<'PY'
import zipfile
with zipfile.ZipFile('build/unsigned.apk','a') as z:z.write('build/dex/classes.dex','classes.dex')
PY
"$snap_sms_bt/zipalign" -f -p 4 build/unsigned.apk build/aligned.apk
if [ ! -f .signing/snap-sms-test.jks ]; then
 keytool -genkeypair -keystore .signing/snap-sms-test.jks -storepass android -keypass android -alias snap-sms-test -dname 'CN=SNAP SMS Puente Test, O=SNAPTVNOW' -keyalg RSA -keysize 2048 -validity 10000 -noprompt
fi
java -jar "$snap_sms_bt/lib/apksigner.jar" sign --ks .signing/snap-sms-test.jks --ks-pass pass:android --ks-key-alias snap-sms-test --out build/SNAP-SMS-Puente-0.2.0.apk build/aligned.apk
java -jar "$snap_sms_bt/lib/apksigner.jar" verify --verbose build/SNAP-SMS-Puente-0.2.0.apk
"$snap_sms_bt/aapt2" dump badging build/SNAP-SMS-Puente-0.2.0.apk | head -12
