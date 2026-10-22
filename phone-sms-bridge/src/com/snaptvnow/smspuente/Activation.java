package com.snaptvnow.smspuente;
import android.content.SharedPreferences;
final class Activation {
 static boolean enable(SharedPreferences preferences,long now){SharedPreferences.Editor edit=preferences.edit().putBoolean("enabled",true);if(!preferences.contains("since"))edit.putLong("since",now);return edit.commit();}
}
