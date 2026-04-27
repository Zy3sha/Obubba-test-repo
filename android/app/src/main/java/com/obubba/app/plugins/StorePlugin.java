package com.obubba.app.plugins;

import android.app.Activity;
import android.content.SharedPreferences;
import android.util.Log;
import androidx.annotation.NonNull;
import com.android.billingclient.api.*;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

@CapacitorPlugin(name = "OBStore")
public class StorePlugin extends Plugin implements PurchasesUpdatedListener {

    private static final String TAG = "OBStore";
    // v1 kept for existing subscribers (Google grandfathers their price)
    private static final List<String> PRODUCT_IDS = Arrays.asList(
        "com.obubba.premium.monthly",
        "com.obubba.premium.annual",
        "com.obubba.premium.lifetime",
        "com.obubba.premium.monthly.v2",
        "com.obubba.premium.annual.v2",
        "com.obubba.premium.lifetime.v2"
    );
    private static final List<String> SUB_IDS = Arrays.asList(
        "com.obubba.premium.monthly",
        "com.obubba.premium.annual",
        "com.obubba.premium.monthly.v2",
        "com.obubba.premium.annual.v2"
    );
    private static final List<String> LIFETIME_IDS = Arrays.asList(
        "com.obubba.premium.lifetime",
        "com.obubba.premium.lifetime.v2"
    );

    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;
    private List<ProductDetails> cachedProducts = new ArrayList<>();

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases()
            .build();
        connectBilling(null);
    }

    private void connectBilling(Runnable onConnected) {
        try {
            if (billingClient.isReady()) {
                if (onConnected != null) onConnected.run();
                return;
            }
            billingClient.startConnection(new BillingClientStateListener() {
                @Override
                public void onBillingSetupFinished(@NonNull BillingResult result) {
                    try {
                        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK) {
                            Log.i(TAG, "Billing connected");
                            if (onConnected != null) onConnected.run();
                        } else {
                            Log.w(TAG, "Billing connect failed: " + result.getDebugMessage());
                        }
                    } catch (Exception e) {
                        Log.e(TAG, "Billing setup callback error", e);
                    }
                }
                @Override
                public void onBillingServiceDisconnected() {
                    Log.w(TAG, "Billing disconnected");
                }
            });
        } catch (Exception e) {
            Log.e(TAG, "Billing connect error", e);
        }
    }

    @PluginMethod
    public void getProducts(PluginCall call) {
        connectBilling(() -> {
            // Query subscriptions
            QueryProductDetailsParams subParams = QueryProductDetailsParams.newBuilder()
                .setProductList(buildProductList(SUB_IDS, BillingClient.ProductType.SUBS))
                .build();

            QueryProductDetailsParams inappParams = QueryProductDetailsParams.newBuilder()
                .setProductList(buildProductList(LIFETIME_IDS, BillingClient.ProductType.INAPP))
                .build();

            billingClient.queryProductDetailsAsync(subParams, (subResult, subDetails) -> {
                billingClient.queryProductDetailsAsync(inappParams, (inappResult, inappDetails) -> {
                    cachedProducts.clear();
                    if (subDetails != null) cachedProducts.addAll(subDetails);
                    if (inappDetails != null) cachedProducts.addAll(inappDetails);

                    JSArray products = new JSArray();
                    for (ProductDetails pd : cachedProducts) {
                        JSObject p = new JSObject();
                        p.put("id", pd.getProductId());
                        p.put("displayName", pd.getName());
                        p.put("description", pd.getDescription());

                        if (pd.getProductType().equals(BillingClient.ProductType.SUBS)) {
                            List<ProductDetails.SubscriptionOfferDetails> offers = pd.getSubscriptionOfferDetails();
                            if (offers != null && !offers.isEmpty()) {
                                ProductDetails.PricingPhase phase = offers.get(0).getPricingPhases()
                                    .getPricingPhaseList().get(0);
                                p.put("displayPrice", phase.getFormattedPrice());
                                p.put("price", phase.getPriceAmountMicros() / 1_000_000.0);
                                p.put("type", "subscription");
                                String period = phase.getBillingPeriod();
                                p.put("period", period.contains("Y") ? "annual" : "monthly");
                            }
                        } else {
                            ProductDetails.OneTimePurchaseOfferDetails otpd = pd.getOneTimePurchaseOfferDetails();
                            if (otpd != null) {
                                p.put("displayPrice", otpd.getFormattedPrice());
                                p.put("price", otpd.getPriceAmountMicros() / 1_000_000.0);
                            }
                            p.put("type", "nonConsumable");
                            p.put("period", "lifetime");
                        }
                        products.put(p);
                    }

                    Log.i(TAG, "Loaded " + cachedProducts.size() + " products");
                    JSObject ret = new JSObject();
                    ret.put("products", products);
                    call.resolve(ret);
                });
            });
        });
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null) { call.reject("productId required"); return; }

        connectBilling(() -> {
            ProductDetails target = null;
            for (ProductDetails pd : cachedProducts) {
                if (pd.getProductId().equals(productId)) { target = pd; break; }
            }
            if (target != null) {
                launchPurchaseFlow(call, target);
            } else {
                // Product not cached — query on-demand before purchasing
                String productType = SUB_IDS.contains(productId)
                    ? BillingClient.ProductType.SUBS : BillingClient.ProductType.INAPP;
                QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
                    .setProductList(Arrays.asList(
                        QueryProductDetailsParams.Product.newBuilder()
                            .setProductId(productId)
                            .setProductType(productType)
                            .build()))
                    .build();
                billingClient.queryProductDetailsAsync(params, (result, detailsList) -> {
                    if (result.getResponseCode() == BillingClient.BillingResponseCode.OK
                            && detailsList != null && !detailsList.isEmpty()) {
                        ProductDetails fetched = detailsList.get(0);
                        cachedProducts.add(fetched);
                        launchPurchaseFlow(call, fetched);
                    } else {
                        call.reject("Product not found: " + productId);
                    }
                });
            }
        });
    }

    private void launchPurchaseFlow(PluginCall call, ProductDetails target) {
        Activity activity = getActivity();
        if (activity == null) { call.reject("Activity not available"); return; }

        pendingPurchaseCall = call;

        BillingFlowParams.ProductDetailsParams.Builder pdpBuilder =
            BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(target);

        if (target.getProductType().equals(BillingClient.ProductType.SUBS)) {
            List<ProductDetails.SubscriptionOfferDetails> offers = target.getSubscriptionOfferDetails();
            if (offers != null && !offers.isEmpty()) {
                pdpBuilder.setOfferToken(offers.get(0).getOfferToken());
            }
        }

        BillingFlowParams flowParams = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(Arrays.asList(pdpBuilder.build()))
            .build();

        BillingResult flowResult = billingClient.launchBillingFlow(activity, flowParams);
        if (flowResult.getResponseCode() != BillingClient.BillingResponseCode.OK) {
            pendingPurchaseCall = null;
            call.reject("Failed to launch billing: " + flowResult.getDebugMessage());
        }
    }

    @Override
    public void onPurchasesUpdated(@NonNull BillingResult result, List<Purchase> purchases) {
        if (result.getResponseCode() == BillingClient.BillingResponseCode.OK && purchases != null) {
            for (Purchase purchase : purchases) {
                acknowledgePurchase(purchase);
            }
            setPremium(true);
            if (pendingPurchaseCall != null) {
                JSObject ret = new JSObject();
                ret.put("success", true);
                ret.put("isPremium", true);
                pendingPurchaseCall.resolve(ret);
                pendingPurchaseCall = null;
            }
        } else if (result.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            if (pendingPurchaseCall != null) {
                JSObject ret = new JSObject();
                ret.put("success", false);
                ret.put("cancelled", true);
                ret.put("isPremium", false);
                pendingPurchaseCall.resolve(ret);
                pendingPurchaseCall = null;
            }
        } else {
            if (pendingPurchaseCall != null) {
                pendingPurchaseCall.reject("Purchase failed: " + result.getDebugMessage());
                pendingPurchaseCall = null;
            }
        }
    }

    private void acknowledgePurchase(Purchase purchase) {
        if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED && !purchase.isAcknowledged()) {
            AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
                .setPurchaseToken(purchase.getPurchaseToken())
                .build();
            billingClient.acknowledgePurchase(params, result ->
                Log.i(TAG, "Acknowledge: " + result.getResponseCode()));
        }
    }

    @PluginMethod
    public void restore(PluginCall call) {
        connectBilling(() -> {
            boolean[] found = {false};

            // Check subscriptions
            billingClient.queryPurchasesAsync(
                QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build(),
                (subResult, subPurchases) -> {
                    for (Purchase p : subPurchases) {
                        if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                            for (String pid : p.getProducts()) {
                                if (PRODUCT_IDS.contains(pid)) { found[0] = true; break; }
                            }
                        }
                    }

                    // Check in-app (lifetime)
                    billingClient.queryPurchasesAsync(
                        QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build(),
                        (inappResult, inappPurchases) -> {
                            for (Purchase p : inappPurchases) {
                                if (p.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                                    for (String pid : p.getProducts()) {
                                        if (LIFETIME_IDS.contains(pid)) { found[0] = true; break; }
                                    }
                                }
                            }

                            setPremium(found[0]);
                            Log.i(TAG, "Restore: isPremium=" + found[0]);
                            JSObject ret = new JSObject();
                            ret.put("isPremium", found[0]);
                            call.resolve(ret);
                        });
                });
        });
    }

    @PluginMethod
    public void getEntitlements(PluginCall call) {
        restore(call); // Same logic — check active purchases
    }

    private void setPremium(boolean premium) {
        SharedPreferences prefs = getContext().getSharedPreferences("obubba_prefs", android.content.Context.MODE_PRIVATE);
        prefs.edit().putBoolean("ob_premium", premium).apply();
    }

    private List<QueryProductDetailsParams.Product> buildProductList(List<String> ids, String type) {
        List<QueryProductDetailsParams.Product> list = new ArrayList<>();
        for (String id : ids) {
            list.add(QueryProductDetailsParams.Product.newBuilder()
                .setProductId(id)
                .setProductType(type)
                .build());
        }
        return list;
    }
}
