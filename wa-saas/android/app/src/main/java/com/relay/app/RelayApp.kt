package com.relay.app

import android.app.Application
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import com.relay.app.core.realtime.EventStream
import dagger.hilt.android.HiltAndroidApp
import javax.inject.Inject

@HiltAndroidApp
class RelayApp : Application() {
    @Inject lateinit var events: EventStream

    override fun onCreate() {
        super.onCreate()
        // Live updates only while the app is visible; bulk sending never depends on the phone.
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) = events.start()
            override fun onStop(owner: LifecycleOwner) = events.stop()
        })
    }
}
