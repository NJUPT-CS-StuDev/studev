package top.hicancan.studev.account

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import androidx.datastore.core.CorruptionException
import androidx.datastore.core.DataStoreFactory
import androidx.datastore.core.Serializer
import androidx.datastore.core.handlers.ReplaceFileCorruptionHandler
import kotlinx.coroutines.flow.first
import java.io.InputStream
import java.io.OutputStream
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

internal class AccountCipher(private val key: () -> SecretKey) {
    fun encrypt(bytes: ByteArray): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key()); cipher.updateAAD("studev-account-v1".toByteArray())
        return byteArrayOf(1) + cipher.iv + cipher.doFinal(bytes)
    }
    fun decrypt(bytes: ByteArray): ByteArray {
        require(bytes.size >= 30 && bytes[0] == 1.toByte())
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(1, 13)))
        cipher.updateAAD("studev-account-v1".toByteArray())
        return cipher.doFinal(bytes.copyOfRange(13, bytes.size))
    }
}
class KeystoreAccountStorage private constructor(context: Context) : AccountStorage {
    private val alias = "studev.account.v1"
    private val cipher = AccountCipher {
        val keystore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (keystore.getKey(alias, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setKeySize(256).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }
    private val store = DataStoreFactory.create(
        serializer = object : Serializer<StoredAccount> {
            override val defaultValue get() = StoredAccount()
            override suspend fun readFrom(input: InputStream): StoredAccount = try {
                val bytes = input.accountBytes(65_536)
                accountJson.decodeFromString<StoredAccount>(cipher.decrypt(bytes).toString(Charsets.UTF_8))
            } catch (error: Exception) { throw CorruptionException("Stored account could not be decrypted", error) }
            override suspend fun writeTo(t: StoredAccount, output: OutputStream) { output.write(cipher.encrypt(accountJson.encodeToString(t).toByteArray(Charsets.UTF_8))) }
        },
        corruptionHandler = ReplaceFileCorruptionHandler { StoredAccount() },
        produceFile = { context.noBackupFilesDir.resolve("account/session.bin") },
    )
    override suspend fun read() = store.data.first()
    override suspend fun write(value: StoredAccount) { store.updateData { value } }
    companion object {
        @Volatile private var instance: KeystoreAccountStorage? = null
        fun get(context: Context): KeystoreAccountStorage = instance ?: synchronized(this) { instance ?: KeystoreAccountStorage(context.applicationContext).also { instance = it } }
    }
}
object Accounts {
    @Volatile private var client: AccountClient? = null
    fun get(context: Context): AccountClient = client ?: synchronized(this) { client ?: AccountClient(KeystoreAccountStorage.get(context), HttpsPlatformTransport()).also { client = it } }
}
