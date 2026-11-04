package com.shixu.checklist;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(ShixuTtsPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
