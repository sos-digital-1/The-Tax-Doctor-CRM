package com.taxdoctor.team;

import android.os.Bundle;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Tax Doctor Team (staff / admin app) - Built by Smack Online Services OPC Pvt Ltd
 * FLAG_SECURE keeps client data out of screenshots, screen recordings and the recent-apps preview.
 */
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
        super.onCreate(savedInstanceState);
    }
}
