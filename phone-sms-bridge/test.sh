#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
snap_sms_sdk="${SNAP_SMS_SDK:?Set SNAP_SMS_SDK to an Android SDK}"
snap_sms_jar="${SNAP_SMS_ANDROID_JAR:-$snap_sms_sdk/android-35/android.jar}"
mkdir -p build/tests
java -m jdk.compiler/com.sun.tools.javac.Main -encoding UTF-8 -cp "$snap_sms_jar" -d build/tests src/com/snaptvnow/smspuente/Activation.java tests/ActivationTest.java
java -cp "build/tests:$snap_sms_jar" com.snaptvnow.smspuente.ActivationTest
