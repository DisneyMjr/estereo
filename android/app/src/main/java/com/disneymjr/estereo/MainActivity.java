package com.disneymjr.estereo;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import androidx.webkit.WebViewAssetLoader;

public final class MainActivity extends Activity {
    private ValueCallback<Uri[]> files;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        WebView view = new WebView(this);
        setContentView(view);
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this)).build();
        view.getSettings().setJavaScriptEnabled(true);
        view.getSettings().setDomStorageEnabled(true);
        view.getSettings().setAllowFileAccess(false);
        view.getSettings().setMediaPlaybackRequiresUserGesture(false);
        view.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView webView, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String url = uri.toString();
                if (url.equals("https://appassets.androidplatform.net/assets/index.html")) return false;
                if (url.equals("https://www.tiktok.com/@disneymkt") || url.equals("https://www.instagram.com/disneymkt/") || url.equals("https://github.com/DisneyMjr/estereo#readme") || url.equals("https://github.com/DisneyMjr/estereo/issues")) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                    catch (ActivityNotFoundException ignored) {}
                }
                return true;
            }
        });
        view.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (files != null) files.onReceiveValue(null);
                files = callback;
                try { startActivityForResult(params.createIntent(), 1); }
                catch (ActivityNotFoundException error) {
                    files.onReceiveValue(null);
                    files = null;
                }
                return true;
            }
        });
        view.loadUrl("https://appassets.androidplatform.net/assets/index.html");
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1 && files != null) {
            files.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(result, data));
            files = null;
        }
    }
}
