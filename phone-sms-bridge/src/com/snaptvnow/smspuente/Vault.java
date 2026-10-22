package com.snaptvnow.smspuente;
import android.content.*;import android.security.keystore.*;import android.util.Base64;import java.security.*;import javax.crypto.*;import javax.crypto.spec.GCMParameterSpec;import org.json.*;
final class Vault {
 static final String API="https://resellers.snaptvnow.com/api/sms-device";
 final Context c;final android.content.SharedPreferences p;
 Vault(Context c){this.c=c.getApplicationContext();p=c.getSharedPreferences("sms_bridge",0);}
 String id(){String id=p.getString("id","");if(id.isEmpty()){id=java.util.UUID.randomUUID().toString();p.edit().putString("id",id).commit();}return id;}
 String token()throws Exception{KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);String alias="snap_sms_device";if(!ks.containsAlias(alias)){KeyGenerator g=KeyGenerator.getInstance("AES","AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}javax.crypto.SecretKey key=(javax.crypto.SecretKey)ks.getKey(alias,null);String saved=p.getString("token","");Cipher cipher=Cipher.getInstance("AES/GCM/NoPadding");if(!saved.isEmpty()){cipher.init(Cipher.DECRYPT_MODE,key,new GCMParameterSpec(128,Base64.decode(p.getString("iv",""),0)));return new String(cipher.doFinal(Base64.decode(saved,0)),"UTF-8");}byte[] bytes=new byte[32];new SecureRandom().nextBytes(bytes);StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(java.util.Locale.US,"%02x",b&255));cipher.init(Cipher.ENCRYPT_MODE,key);byte[] encrypted=cipher.doFinal(s.toString().getBytes("UTF-8"));if(!p.edit().putString("token",Base64.encodeToString(encrypted,2)).putString("iv",Base64.encodeToString(cipher.getIV(),2)).commit())throw new Exception("No se guardó la clave");return s.toString();}
 boolean paired(){return p.getBoolean("paired",false);}boolean enabled(){return paired()&&p.getBoolean("enabled",false);}
 void status(String s){p.edit().putString("status",s).apply();}
 String status(){return p.getString("status","Todavía sin conectar al panel.");}
 static String day(long time){return new java.text.SimpleDateFormat("yyyy-MM-dd",java.util.Locale.US).format(new java.util.Date(time));}
}
