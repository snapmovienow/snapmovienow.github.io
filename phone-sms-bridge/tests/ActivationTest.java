package com.snaptvnow.smspuente;
import android.content.SharedPreferences;import java.lang.reflect.*;import java.util.*;
public class ActivationTest {
 static final class Preferences implements InvocationHandler {
  final Map<String,Object> saved=new HashMap<>(),staged=new HashMap<>();boolean fail;
  final SharedPreferences.Editor editor=(SharedPreferences.Editor)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.Editor.class},this);
  final SharedPreferences prefs=(SharedPreferences)Proxy.newProxyInstance(getClass().getClassLoader(),new Class[]{SharedPreferences.class},this);
  public Object invoke(Object p,Method m,Object[] a){switch(m.getName()){case "edit":staged.clear();return editor;case "contains":return saved.containsKey(a[0]);case "putLong":case "putBoolean":staged.put((String)a[0],a[1]);return editor;case "commit":if(fail)return false;saved.putAll(staged);return true;default:throw new AssertionError("Unexpected operation "+m.getName());}}
 }
 static void check(boolean b){if(!b)throw new AssertionError();}
 public static void main(String[] args){Preferences p=new Preferences();check(Activation.enable(p.prefs,1000));check(p.saved.get("since").equals(1000L));p.saved.put("cursor",83L);p.saved.put("enabled",false);check(Activation.enable(p.prefs,9000));check(p.saved.get("since").equals(1000L));check(p.saved.get("cursor").equals(83L));check(p.saved.get("enabled").equals(true));
 // Updating an installed 0.1.0 app retains its saved activation and scan cursor.
 Preferences legacy=new Preferences();legacy.saved.put("since",500L);legacy.saved.put("cursor",42L);check(Activation.enable(legacy.prefs,30000));check(legacy.saved.get("since").equals(500L));check(legacy.saved.get("cursor").equals(42L));Preferences failing=new Preferences();failing.fail=true;check(!Activation.enable(failing.prefs,10));check(!failing.saved.containsKey("since"));System.out.println("Activation regression checks passed: first activation, pause/resume, upgrade and persistence failure.");}
}
