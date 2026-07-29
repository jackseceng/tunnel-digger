/* Tunnel Digger - Tailscale Exit Node Generator */

// ISO 3166-1 alpha-3 to alpha-2 mapping
var ISO3_TO_2 = {
  DEU: "DE",
  FIN: "FI",
  USA: "US",
  AUS: "AU",
  CAN: "CA",
  NLD: "NL",
  SGP: "SG",
  GBR: "GB",
  IND: "IN",
  JPN: "JP",
};

// App state
var state = {
  selectedProvider: null,
  selectedPlan: null,
  selectedRegion: null,
  selectedCountry: null,
  skippedCredentials: false,
};

function el(id) {
  return document.getElementById(id);
}

// DOM refs - all present in index.html
var card2 = el("card2");
var card3 = el("card3");
var card4 = el("card4");
var instructionsPreview = el("instructions-preview");
var card1Actions = el("card1-actions");
var providerPicker = el("provider-picker");
var pickerCountryName = el("picker-country-name");
var pickerOptions = el("picker-options");
var selectionSummary = el("selection-summary");
var selectionText = el("selection-text");
var clearSelectionBtn = el("clear-selection");
var nextToCard2Btn = el("next-to-card2");
var nextToCard3Btn = el("next-to-card3");
var nextToCard4Btn = el("next-to-card4");
var accountCheck = el("account-check");
var noAccountPanel = el("no-account-panel");
var billingPanel = el("billing-panel");
var hasAccountBtn = el("has-account-btn");
var noAccountBtn = el("no-account-btn");
var accountCreatedBtn = el("account-created-btn");
var providerNameCheck = el("provider-name-check");
var providerNameSignup = el("provider-name-signup");
var providerNameSignupLink = el("provider-name-signup-link");
var signupLink = el("signup-link");
var tailscaleKeyInput = el("tailscale-key");
var tsKeyWarning = el("ts-key-warning");
var providerApiKeyInput = el("provider-api-key");
var summaryGrid = el("summary-grid");
var downloadBtn = el("download-btn");

// --- Data + Map ---------------------------------------------------------

var pricingData = null;
var countryIndex = {};
var leafletMap = null;
var geoLayer = null;
var tileLayer = null;

var GEOJSON_URL =
  "https://cdn.jsdelivr.net/gh/johan/world.geo.json@master/countries.geo.json";
var COLORS = {
  hetzner: "#7c3aed",
  digitalocean: "#2563eb",
  linode: "#0891b2",
  multi: "#059669",
};

Promise.all([
  fetch("js/pricing.json").then(function (r) {
    return r.json();
  }),
  fetch(GEOJSON_URL).then(function (r) {
    return r.json();
  }),
]).then(function (res) {
  pricingData = res[0];
  buildCountryIndex();
  initMap(res[1]);
});

function buildCountryIndex() {
  countryIndex = {};
  var keys = Object.keys(pricingData.providers);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var prov = pricingData.providers[key];
    for (var j = 0; j < prov.regions.length; j++) {
      var r = prov.regions[j];
      var c = r.country;
      if (!countryIndex[c]) countryIndex[c] = [];
      var dup = false;
      for (var k = 0; k < countryIndex[c].length; k++) {
        if (countryIndex[c][k].provider === key) {
          dup = true;
          break;
        }
      }
      if (!dup) {
        // Use region-specific plan if specified, otherwise cheapest
        var regionPlan = prov.plans[0];
        if (r.planCode) {
          for (var m = 0; m < prov.plans.length; m++) {
            if (prov.plans[m].code === r.planCode) {
              regionPlan = prov.plans[m];
              break;
            }
          }
        }
        countryIndex[c].push({
          provider: key,
          displayName: prov.displayName,
          region: r,
          plan: regionPlan,
          billingAlerts: key !== "linode",
        });
      }
    }
  }
}

function initMap(geo) {
  leafletMap = L.map("map", {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    maxZoom: 5,
    worldCopyJump: false,
    maxBounds: [
      [-90, -180],
      [90, 180],
    ],
    maxBoundsViscosity: 1.0,
  });
  tileLayer = L.tileLayer(getMapTileUrl(), {
    attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: "abcd",
    maxZoom: 19,
    noWrap: true,
  }).addTo(leafletMap);
  geoLayer = L.geoJSON(geo, {
    style: styleCountry,
    onEachFeature: bindFeatureEvents,
    noWrap: true,
  }).addTo(leafletMap);

  // Add markers for tiny countries that are hard to click
  addSmallCountryMarkers();
}

function addSmallCountryMarkers() {
  // Singapore is too small to click on the map - add a visible circle marker
  var tinyCountries = [
    { iso2: "SG", lat: 1.35, lng: 103.82, name: "Singapore" },
  ];
  for (var i = 0; i < tinyCountries.length; i++) {
    var tc = tinyCountries[i];
    var opts = countryIndex[tc.iso2];
    if (!opts || opts.length === 0) continue;
    var color = opts.length === 1 ? COLORS[opts[0].provider] : COLORS.multi;
    var marker = L.circleMarker([tc.lat, tc.lng], {
      radius: 8,
      fillColor: color,
      fillOpacity: 0.8,
      color: "#fff",
      weight: 2,
    }).addTo(leafletMap);
    (function (marker, iso2, name, opts) {
      marker.on({
        mouseover: function (e) {
          showTooltipForMarker(e, name, opts);
        },
        mouseout: function () {
          hideTooltip();
        },
        click: function () {
          if (opts.length === 1) {
            commitSelection(iso2, opts[0]);
          } else {
            pickerCountryName.textContent = name;
            var html = "";
            for (var j = 0; j < opts.length; j++) {
              var o = opts[j];
              html +=
                '<button class="picker-option" data-provider="' +
                o.provider +
                '">' +
                '<div class="picker-option-header"><strong>' +
                o.displayName +
                "</strong></div>" +
                '<div class="picker-option-specs">' +
                o.plan.vcpu +
                " vCPU / " +
                o.plan.ram +
                " / " +
                o.plan.disk +
                "</div>" +
                '<div class="picker-option-price">$' +
                o.plan.price.toFixed(2) +
                "/mo" +
                ' <span class="picker-region">&middot; ' +
                o.region.name +
                "</span></div>" +
                "</button>";
            }
            pickerOptions.innerHTML = html;
            var btns = pickerOptions.querySelectorAll(".picker-option");
            for (var k = 0; k < btns.length; k++) {
              (function (btn, allOpts) {
                btn.addEventListener("click", function () {
                  var chosen = null;
                  for (var m = 0; m < allOpts.length; m++) {
                    if (allOpts[m].provider === btn.dataset.provider) {
                      chosen = allOpts[m];
                      break;
                    }
                  }
                  commitSelection(iso2, chosen);
                  providerPicker.style.display = "none";
                });
              })(btns[k], opts);
            }
            providerPicker.style.display = "block";
            providerPicker.scrollIntoView({
              behavior: "smooth",
              block: "nearest",
            });
          }
        },
      });
    })(marker, tc.iso2, tc.name, opts);
  }
}

function showTooltipForMarker(e, name, opts) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "map-tooltip";
    el("map").appendChild(tooltipEl);
  }
  var rows = "";
  for (var i = 0; i < opts.length; i++) {
    var o = opts[i];
    if (i > 0) rows += '<hr class="tt-divider">';
    rows +=
      '<div class="tt-provider"><strong>' +
      o.displayName +
      "</strong><br>" +
      '<span class="tt-spec">' +
      o.plan.vcpu +
      " vCPU / " +
      o.plan.ram +
      " / " +
      o.plan.disk +
      "</span><br>" +
      '<span class="tt-price">$' +
      o.plan.price.toFixed(2) +
      "/mo</span>" +
      '<span class="tt-region"> &middot; ' +
      o.region.name +
      "</span></div>";
  }
  tooltipEl.innerHTML = '<div class="tt-country">' + name + "</div>" + rows;
  tooltipEl.style.display = "block";
  positionTooltip(e.originalEvent);
}

function getOpts(feature) {
  var iso2 = ISO3_TO_2[feature.id];
  return iso2 ? countryIndex[iso2] || null : null;
}

function styleCountry(feature) {
  var opts = getOpts(feature);
  if (!opts || opts.length === 0)
    return {
      fillColor: "#cbd5e1",
      fillOpacity: 0.4,
      color: "#fff",
      weight: 0.5,
    };
  var c = opts.length === 1 ? COLORS[opts[0].provider] : COLORS.multi;
  return { fillColor: c, fillOpacity: 0.7, color: "#fff", weight: 1 };
}

function bindFeatureEvents(feature, layer) {
  var opts = getOpts(feature);
  if (!opts || opts.length === 0) return;
  layer.on({
    mouseover: function (e) {
      e.target.setStyle({ fillOpacity: 1, weight: 2 });
      e.target.bringToFront();
      showTooltip(e, feature, opts);
    },
    mouseout: function (e) {
      if (ISO3_TO_2[feature.id] !== state.selectedCountry)
        geoLayer.resetStyle(e.target);
      hideTooltip();
    },
    click: function () {
      selectCountry(feature, opts);
    },
  });
}

// --- Tooltip -----------------------------------------------------------

var tooltipEl = null;

function showTooltip(e, feature, opts) {
  if (!tooltipEl) {
    tooltipEl = document.createElement("div");
    tooltipEl.className = "map-tooltip";
    el("map").appendChild(tooltipEl);
  }
  var rows = "";
  for (var i = 0; i < opts.length; i++) {
    var o = opts[i];
    if (i > 0) rows += '<hr class="tt-divider">';
    rows +=
      '<div class="tt-provider"><strong>' +
      o.displayName +
      "</strong><br>" +
      '<span class="tt-spec">' +
      o.plan.vcpu +
      " vCPU / " +
      o.plan.ram +
      " / " +
      o.plan.disk +
      "</span><br>" +
      '<span class="tt-price">$' +
      o.plan.price.toFixed(2) +
      "/mo</span>" +
      '<span class="tt-region"> &middot; ' +
      o.region.name +
      "</span></div>";
  }
  tooltipEl.innerHTML =
    '<div class="tt-country">' + feature.properties.name + "</div>" + rows;
  tooltipEl.style.display = "block";
  positionTooltip(e.originalEvent);
}

function positionTooltip(ev) {
  if (!tooltipEl) return;
  var rect = el("map").getBoundingClientRect();
  var x = ev.clientX - rect.left + 14,
    y = ev.clientY - rect.top - 10;
  var tw = tooltipEl.offsetWidth || 230,
    th = tooltipEl.offsetHeight || 80;
  tooltipEl.style.left = Math.min(x, rect.width - tw - 6) + "px";
  tooltipEl.style.top = Math.max(4, Math.min(y, rect.height - th - 6)) + "px";
}

function hideTooltip() {
  if (tooltipEl) tooltipEl.style.display = "none";
}

el("map").addEventListener("mousemove", function (e) {
  if (tooltipEl && tooltipEl.style.display !== "none") positionTooltip(e);
});

// --- Country / Provider Selection --------------------------------------

function selectCountry(feature, opts) {
  var iso2 = ISO3_TO_2[feature.id];
  if (opts.length === 1) {
    commitSelection(iso2, opts[0]);
  } else {
    pickerCountryName.textContent = feature.properties.name;
    var html = "";
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      html +=
        '<button class="picker-option" data-provider="' +
        o.provider +
        '">' +
        '<div class="picker-option-header"><strong>' +
        o.displayName +
        "</strong></div>" +
        '<div class="picker-option-specs">' +
        o.plan.vcpu +
        " vCPU / " +
        o.plan.ram +
        " / " +
        o.plan.disk +
        "</div>" +
        '<div class="picker-option-price">$' +
        o.plan.price.toFixed(2) +
        "/mo" +
        ' <span class="picker-region">&middot; ' +
        o.region.name +
        "</span></div>" +
        "</button>";
    }
    pickerOptions.innerHTML = html;
    var btns = pickerOptions.querySelectorAll(".picker-option");
    for (var j = 0; j < btns.length; j++) {
      (function (btn, allOpts) {
        btn.addEventListener("click", function () {
          var chosen = null;
          for (var k = 0; k < allOpts.length; k++) {
            if (allOpts[k].provider === btn.dataset.provider) {
              chosen = allOpts[k];
              break;
            }
          }
          commitSelection(iso2, chosen);
          providerPicker.style.display = "none";
        });
      })(btns[j], opts);
    }
    providerPicker.style.display = "block";
    providerPicker.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function commitSelection(iso2, option) {
  state.selectedCountry = iso2;
  state.selectedProvider = option.provider;
  state.selectedPlan = { code: option.plan.code, name: option.plan.name };
  state.selectedRegion = option.region.code;

  collapseDownstreamCards();

  geoLayer.eachLayer(function (l) {
    var o = getOpts(l.feature);
    if (!o) return;
    l.setStyle(
      ISO3_TO_2[l.feature.id] === iso2
        ? { fillOpacity: 1, weight: 2.5, color: "#fff" }
        : { fillOpacity: 0.2 },
    );
  });

  selectionText.textContent =
    option.displayName +
    " \u00b7 " +
    option.region.name +
    " \u00b7 " +
    option.plan.name +
    " \u00b7 $" +
    option.plan.price.toFixed(2) +
    "/mo";
  selectionSummary.style.display = "flex";
  card1Actions.style.display = "block";
  providerPicker.style.display = "none";
  hideTooltip();

  updateApiKeyLabel(option.displayName);
}

function collapseDownstreamCards() {
  var cards = [card2, card3, card4, instructionsPreview];
  for (var i = 0; i < cards.length; i++) {
    cards[i].style.display = "none";
    cards[i].classList.remove("card-visible");
  }
  accountCheck.style.display = "block";
  noAccountPanel.style.display = "none";
  billingPanel.style.display = "none";
  el("billing-acks").innerHTML = "";
  el("billing-next-actions").style.display = "none";
  // Reset card 3 Tailscale check
  if (el("tailscale-account-check"))
    el("tailscale-account-check").style.display = "block";
  if (el("no-tailscale-panel")) el("no-tailscale-panel").style.display = "none";
  if (el("credentials-form")) el("credentials-form").style.display = "none";
  state.skippedCredentials = false;
}

clearSelectionBtn.addEventListener("click", function () {
  state.selectedCountry =
    state.selectedProvider =
    state.selectedPlan =
    state.selectedRegion =
      null;
  geoLayer.eachLayer(function (l) {
    geoLayer.resetStyle(l);
  });
  collapseDownstreamCards();
  selectionSummary.style.display = "none";
  providerPicker.style.display = "none";
  card1Actions.style.display = "none";
});

// --- Card 1 -> 2 -------------------------------------------------------

nextToCard2Btn.addEventListener("click", function () {
  openCard2();
});

function updateApiKeyLabel(displayName) {
  var label = el("provider-api-key-label");
  var hint = el("provider-api-key-hint");
  if (label) label.textContent = displayName + " API Token";
  if (hint && pricingData) {
    var prov = pricingData.providers[state.selectedProvider];
    var docsLink = prov.apiTokenDocs
      ? ' <a href="' +
        prov.apiTokenDocs +
        '" target="_blank" rel="noopener">See how to create one &rarr;</a>'
      : "";
    hint.innerHTML =
      "Create a token with permissions to manage servers/droplets/instances." +
      docsLink;
  }
}

// --- Card 2: Account + Billing -----------------------------------------

function openCard2() {
  var prov = pricingData.providers[state.selectedProvider];
  providerNameCheck.textContent = prov.displayName;
  providerNameSignup.textContent = prov.displayName;
  providerNameSignupLink.textContent = prov.displayName;
  signupLink.href = prov.signupPage || prov.website;
  accountCheck.style.display = "block";
  noAccountPanel.style.display = "none";
  billingPanel.style.display = "none";
  revealCard(card2);
}

hasAccountBtn.addEventListener("click", function () {
  accountCheck.style.display = "none";
  showBillingPanel();
});

noAccountBtn.addEventListener("click", function () {
  accountCheck.style.display = "none";
  noAccountPanel.style.display = "block";
});

accountCreatedBtn.addEventListener("click", function () {
  noAccountPanel.style.display = "none";
  showBillingPanel();
});

function showBillingPanel() {
  el("billing-acks").innerHTML = "";
  el("billing-next-actions").style.display = "none";
  billingPanel.style.display = "block";
  renderAcks();
  billingPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function renderAcks() {
  var acks = [
    {
      id: "ack-pricing",
      text: "Prices shown are estimates. I'll check current pricing before deploying.",
    },
    {
      id: "ack-responsibility",
      text: "I'm responsible for all charges on my account. This tool just generates config files.",
    },
  ];
  var html = "";
  for (var i = 0; i < acks.length; i++) {
    var a = acks[i];
    html +=
      '<label class="ack-item">' +
      '<input type="checkbox" class="billing-ack-cb" id="' +
      a.id +
      '">' +
      "<span>" +
      a.text +
      "</span></label>";
  }
  var div = el("billing-acks");
  div.innerHTML = html;
  var cbs = div.querySelectorAll(".billing-ack-cb");
  for (var j = 0; j < cbs.length; j++) {
    cbs[j].addEventListener("change", checkAcks);
  }
  el("billing-next-actions").style.display = "block";
  el("next-to-card3").disabled = true;
  checkAcks();
  setTimeout(function () {
    div.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 50);
}

function checkAcks() {
  var cbs = document.querySelectorAll(".billing-ack-cb");
  var all = Array.prototype.slice.call(cbs);
  var done =
    all.length > 0 &&
    all.every(function (cb) {
      return cb.checked;
    });
  el("next-to-card3").disabled = !done;
}

// Billing -> credentials
nextToCard3Btn.addEventListener("click", function () {
  revealCard(card3);
});

// --- Card 3: Credentials -> Summary ------------------------------------

// Tailscale account check
el("has-tailscale-btn").addEventListener("click", function () {
  el("tailscale-account-check").style.display = "none";
  el("credentials-form").style.display = "block";
  el("credentials-form").scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
});

el("no-tailscale-btn").addEventListener("click", function () {
  el("tailscale-account-check").style.display = "none";
  el("no-tailscale-panel").style.display = "block";
});

el("tailscale-created-btn").addEventListener("click", function () {
  el("no-tailscale-panel").style.display = "none";
  el("credentials-form").style.display = "block";
  el("credentials-form").scrollIntoView({
    behavior: "smooth",
    block: "nearest",
  });
});

tailscaleKeyInput.addEventListener("input", function () {
  var v = tailscaleKeyInput.value.trim();
  tsKeyWarning.style.display =
    v.length > 0 && v.indexOf("tskey-") !== 0 ? "block" : "none";
});

nextToCard4Btn.addEventListener("click", function () {
  if (!tailscaleKeyInput.value.trim()) {
    tailscaleKeyInput.focus();
    return;
  }
  if (!providerApiKeyInput.value.trim()) {
    providerApiKeyInput.focus();
    return;
  }
  state.skippedCredentials = false;
  renderSummary();
  revealCard(card4);
  el("manual-keys-reminder").style.display = "none";
  downloadBtn.disabled = false;
});

el("skip-credentials").addEventListener("click", function () {
  // User doesn't trust pasting keys here - proceed with placeholders
  tailscaleKeyInput.value = "";
  providerApiKeyInput.value = "";
  state.skippedCredentials = true;
  renderSummary();
  revealCard(card4);
  // Show the manual keys reminder and disable download until ticked
  el("manual-keys-reminder").style.display = "block";
  downloadBtn.disabled = true;
  el("manual-keys-ack").addEventListener("change", function () {
    downloadBtn.disabled = !this.checked;
  });
});

// --- Card 4: Summary ---------------------------------------------------

function renderSummary() {
  var prov = pricingData.providers[state.selectedProvider];
  var plan = null;
  for (var i = 0; i < prov.plans.length; i++) {
    if (prov.plans[i].code === state.selectedPlan.code) {
      plan = prov.plans[i];
      break;
    }
  }
  var region = null;
  for (var j = 0; j < prov.regions.length; j++) {
    if (prov.regions[j].code === state.selectedRegion) {
      region = prov.regions[j];
      break;
    }
  }
  var tsKey = tailscaleKeyInput.value.trim();
  var apiKey = providerApiKeyInput.value.trim();
  var tsDots = tsKey ? "" : "&lt;not provided&gt;";
  var apiDots = apiKey ? "" : "&lt;not provided&gt;";
  for (var k = 0; k < Math.min(tsKey.length, 24); k++) tsDots += "\u2022";
  for (var m = 0; m < Math.min(apiKey.length, 24); m++) apiDots += "\u2022";

  summaryGrid.innerHTML =
    '<div class="summary-item"><span class="summary-label">Provider</span><span class="summary-value">' +
    prov.displayName +
    "</span></div>" +
    '<div class="summary-item"><span class="summary-label">Plan</span><span class="summary-value">' +
    plan.name +
    " &middot; " +
    plan.vcpu +
    " vCPU / " +
    plan.ram +
    " / " +
    plan.disk +
    "</span></div>" +
    '<div class="summary-item"><span class="summary-label">Monthly Cost</span><span class="summary-value summary-price">$' +
    plan.price.toFixed(2) +
    "/mo</span></div>" +
    '<div class="summary-item"><span class="summary-label">Region</span><span class="summary-value">' +
    (region ? region.name : state.selectedRegion) +
    "</span></div>" +
    '<div class="summary-item"><span class="summary-label">Tailscale Key</span><span class="summary-value summary-secret">' +
    tsDots +
    "</span></div>" +
    '<div class="summary-item"><span class="summary-label">' +
    prov.displayName +
    ' Token</span><span class="summary-value summary-secret">' +
    apiDots +
    "</span></div>";
}

// --- Download ----------------------------------------------------------

downloadBtn.addEventListener("click", function () {
  generateFiles(
    state.selectedProvider,
    state.selectedPlan,
    state.selectedRegion,
    tailscaleKeyInput.value.trim(),
    providerApiKeyInput.value.trim(),
  )
    .then(function (files) {
      return bundleAndDownload(files, state.selectedProvider);
    })
    .then(function () {
      showDeploymentInstructions(state.selectedProvider);
      revealCard(instructionsPreview);
    });
});

function generateFiles(provider, planRef, region, tsKey, apiKey) {
  var prov = pricingData.providers[provider];
  var plan = prov.plans[0];
  for (var i = 0; i < prov.plans.length; i++) {
    if (prov.plans[i].code === planRef.code) {
      plan = prov.plans[i];
      break;
    }
  }
  return Promise.all([
    fetch("templates/" + provider + "/main.tf.template").then(function (r) {
      return r.text();
    }),
    fetch("templates/" + provider + "/variables.tf.template").then(
      function (r) {
        return r.text();
      },
    ),
    fetch("templates/" + provider + "/cloud-init.yaml.template").then(
      function (r) {
        return r.text();
      },
    ),
  ]).then(function (tpls) {
    var mainTf = tpls[0].replace(
      /\{\{PROVIDER_CONFIG\}\}/g,
      buildProviderConfig(provider, plan),
    );
    var varsTf = tpls[1].replace(
      /\{\{VARIABLES_CONFIG\}\}/g,
      buildVariableConfig(provider),
    );
    var cloudInit = tpls[2].replace(
      /\{\{CLOUD_INIT_CONFIG\}\}/g,
      buildCloudInit(tsKey),
    );
    var actualTsKey = tsKey || "PASTE_YOUR_TAILSCALE_AUTH_KEY_HERE";
    var actualApiKey = apiKey || "PASTE_YOUR_PROVIDER_API_TOKEN_HERE";
    var tfvars =
      "# Auto-generated -- keep secret! NEVER commit to version control.\n\n" +
      'provider_api_token = "' +
      actualApiKey +
      '"\n' +
      'tailscale_auth_key = "' +
      actualTsKey +
      '"\n' +
      'target_region      = "' +
      region +
      '"\n' +
      'vm_size            = "' +
      plan.code +
      '"\n';
    var tfvarsEx =
      "# Copy to terraform.tfvars and fill in real values\n# NEVER commit terraform.tfvars!\n\n" +
      'provider_api_token = "your-' +
      provider +
      '-api-token-here"\n' +
      'tailscale_auth_key = "tskey-auth-xxxxxxxxxxxx"\n' +
      'target_region      = "' +
      region +
      '"\n' +
      'vm_size            = "' +
      plan.code +
      '"\n';
    return {
      "main.tf": mainTf,
      "variables.tf": varsTf,
      "cloud-init.yaml": cloudInit,
      "terraform.tfvars": tfvars,
      "terraform.tfvars.example": tfvarsEx,
      ".gitignore":
        "terraform.tfvars\n.terraform/\n*.tfstate\n*.tfstate.backup\n",
      "deploy.sh": buildDeployScript(provider),
      "deploy.ps1": buildDeployScriptPS(provider),
      "README.md": buildReadme(prov, plan, region),
    };
  });
}

// --- Terraform builders ------------------------------------------------

function buildProviderConfig(provider, plan) {
  if (provider === "hetzner") {
    return (
      'terraform {\n  required_providers {\n    hcloud = { source = "hetznercloud/hcloud", version = ">= 1.45" }\n  }\n}\n\n' +
      'provider "hcloud" { token = var.provider_api_token }\n\n' +
      'resource "hcloud_server" "exit_node" {\n' +
      '  name        = "tailscale-exit-node"\n' +
      '  image       = "ubuntu-24.04"\n' +
      "  server_type = var.vm_size\n" +
      "  location    = var.target_region\n" +
      '  user_data   = templatefile("${path.module}/cloud-init.yaml", { tailscale_auth_key = var.tailscale_auth_key })\n' +
      '  labels = { managed_by = "terraform", purpose = "tailscale-exit-node" }\n' +
      "}"
    );
  }
  if (provider === "digitalocean") {
    return (
      'terraform {\n  required_providers {\n    digitalocean = { source = "digitalocean/digitalocean", version = ">= 2.40" }\n  }\n}\n\n' +
      'provider "digitalocean" { token = var.provider_api_token }\n\n' +
      'resource "digitalocean_droplet" "exit_node" {\n' +
      '  name = "tailscale-exit-node"\n  image = "ubuntu-24-04-x64"\n' +
      "  size = var.vm_size\n  region = var.target_region\n" +
      '  user_data = templatefile("${path.module}/cloud-init.yaml", { tailscale_auth_key = var.tailscale_auth_key })\n' +
      '  tags = ["tailscale", "exit-node"]\n}'
    );
  }
  if (provider === "linode") {
    return (
      'terraform {\n  required_providers {\n    linode = { source = "linode/linode", version = ">= 2.20" }\n  }\n}\n\n' +
      'provider "linode" { token = var.provider_api_token }\n\n' +
      'resource "linode_instance" "exit_node" {\n' +
      '  label = "tailscale-exit-node"\n  region = var.target_region\n' +
      '  type = var.vm_size\n  image = "linode/ubuntu24.04"\n' +
      '  metadata {\n    user_data = base64encode(templatefile("${path.module}/cloud-init.yaml", { tailscale_auth_key = var.tailscale_auth_key }))\n  }\n' +
      '  tags = ["tailscale", "exit-node"]\n}'
    );
  }
  return "";
}

function buildDeployScript(provider) {
  return (
    "#!/usr/bin/env bash\n" +
    "# deploy.sh -- Tunnel Digger deployment helper\n" +
    "# Usage: chmod +x deploy.sh && ./deploy.sh\n\n" +
    "set -euo pipefail\n\n" +
    'GREEN="\\033[0;32m"; YELLOW="\\033[1;33m"; RED="\\033[0;31m"; NC="\\033[0m"\n\n' +
    'info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }\n' +
    'warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }\n' +
    'error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }\n\n' +
    "# Check Terraform is installed\n" +
    "if ! command -v terraform &>/dev/null; then\n" +
    '  error "Terraform not found. Install it from https://developer.hashicorp.com/terraform/downloads"\n' +
    "fi\n" +
    'info "Terraform $(terraform version -json | grep -o \\"[0-9]\\+\\.[0-9]\\+\\.[0-9]\\+\\" | head -1) found."\n\n' +
    "# Confirm terraform.tfvars exists\n" +
    "if [ ! -f terraform.tfvars ]; then\n" +
    '  error "terraform.tfvars not found. The credentials from your download should be in this file."\n' +
    "fi\n\n" +
    'info "Initialising Terraform..."\n' +
    "terraform init\n\n" +
    'info "Planning deployment..."\n' +
    "terraform plan -out=tfplan\n\n" +
    'echo ""\n' +
    'read -r -p "$(echo -e "${YELLOW}Ready to deploy? This will create real cloud resources and incur costs. [y/N]: ${NC}")" confirm\n' +
    'if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then\n' +
    '  warn "Deployment cancelled."\n' +
    "  exit 0\n" +
    "fi\n\n" +
    'info "Applying..."\n' +
    "terraform apply tfplan\n\n" +
    'info "Done! Your Tailscale exit node is deploying."\n' +
    'info "Approve it at: https://login.tailscale.com/admin/machines"\n' +
    'echo ""\n' +
    'echo "To destroy the VM when you are finished, run:"\n' +
    'echo "  terraform destroy"\n'
  );
}

function buildDeployScriptPS(provider) {
  return (
    "# deploy.ps1 -- Tunnel Digger deployment helper\n" +
    "# Usage: .\\deploy.ps1\n\n" +
    '$ErrorActionPreference = "Stop"\n\n' +
    'function Write-Info  { param($msg) Write-Host "[INFO]  $msg" -ForegroundColor Green  }\n' +
    'function Write-Warn  { param($msg) Write-Host "[WARN]  $msg" -ForegroundColor Yellow }\n' +
    'function Write-Err   { param($msg) Write-Host "[ERROR] $msg" -ForegroundColor Red; exit 1 }\n\n' +
    "# Check Terraform is installed\n" +
    "if (-not (Get-Command terraform -ErrorAction SilentlyContinue)) {\n" +
    '    Write-Err "Terraform not found. Install it from https://developer.hashicorp.com/terraform/downloads"\n' +
    "}\n" +
    "$tfVer = (terraform version -json | ConvertFrom-Json).terraform_version\n" +
    'Write-Info "Terraform $tfVer found."\n\n' +
    "# Confirm terraform.tfvars exists\n" +
    'if (-not (Test-Path "terraform.tfvars")) {\n' +
    '    Write-Err "terraform.tfvars not found. The credentials from your download should be in this file."\n' +
    "}\n\n" +
    'Write-Info "Initialising Terraform..."\n' +
    "terraform init\n\n" +
    'Write-Info "Planning deployment..."\n' +
    "terraform plan -out=tfplan\n\n" +
    'Write-Host ""\n' +
    '$confirm = Read-Host "Ready to deploy? This will create real cloud resources and incur costs. [y/N]"\n' +
    'if ($confirm -ne "y" -and $confirm -ne "Y") {\n' +
    '    Write-Warn "Deployment cancelled."\n' +
    "    exit 0\n" +
    "}\n\n" +
    'Write-Info "Applying..."\n' +
    "terraform apply tfplan\n\n" +
    'Write-Info "Done! Your Tailscale exit node is deploying."\n' +
    'Write-Info "Approve it at: https://login.tailscale.com/admin/machines"\n' +
    'Write-Host ""\n' +
    'Write-Host "To destroy the VM when you are finished, run:"\n' +
    'Write-Host "  terraform destroy"\n'
  );
}

function buildVariableConfig(provider) {
  return (
    'variable "provider_api_token" {\n  type = string\n  sensitive = true\n  description = "Cloud provider API token"\n}\n' +
    'variable "tailscale_auth_key" {\n  type = string\n  sensitive = true\n  description = "Tailscale auth key"\n}\n' +
    'variable "target_region" {\n  type = string\n  description = "Target cloud region code"\n}\n' +
    'variable "vm_size" {\n  type = string\n  description = "VM size/plan code"\n}'
  );
}

function buildCloudInit(authKey) {
  return (
    "#cloud-config\npackage_update: true\npackages:\n  - curl\nruncmd:\n" +
    "  - curl -fsSL https://tailscale.com/install.sh | sh\n" +
    '  - echo "net.ipv4.ip_forward = 1" >> /etc/sysctl.conf\n' +
    '  - echo "net.ipv6.conf.all.forwarding = 1" >> /etc/sysctl.conf\n' +
    "  - sysctl -p\n" +
    "  - tailscale up --authkey=" +
    authKey +
    " --advertise-exit-node --accept-dns=false\n"
  );
}

function buildReadme(prov, plan, region) {
  var date = new Date().toISOString().split("T")[0];
  return (
    "# Tailscale Exit Node -- " +
    prov.displayName +
    "\nGenerated: " +
    date +
    "\n\n" +
    "## Quick Start\n\n```bash\n./deploy.sh   # or .\\deploy.ps1 on Windows\n```\n\n" +
    "Approve exit node: https://login.tailscale.com/admin/machines\n\n" +
    "## Cleanup\n```bash\nterraform destroy\n```\n\n" +
    "Estimated cost: ~$" +
    plan.price.toFixed(2) +
    "/mo\n" +
    "Docs: " +
    prov.website +
    "\n"
  );
}

function bundleAndDownload(files, provider) {
  var zip = new JSZip();
  var keys = Object.keys(files);
  for (var i = 0; i < keys.length; i++) zip.file(keys[i], files[keys[i]]);
  return zip.generateAsync({ type: "blob" }).then(function (blob) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "tailscale-exit-node-" + provider + ".zip";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });
}

// --- Deployment Instructions -------------------------------------------

function showDeploymentInstructions(provider) {
  var prov = pricingData.providers[provider];

  var tailscaleNote =
    '<div class="info-box" style="margin-top:16px;">' +
    "<h4>Approve Exit Node in Tailscale</h4>" +
    '<p style="margin-top:6px;">Once the deploy script finishes, enable your new machine as an exit node:</p>' +
    '<ol class="setup-steps" style="margin-top:8px;margin-bottom:12px;">' +
    "<li>Open the Tailscale Admin Console (link below)</li>" +
    "<li>Find your new <strong>tailscale-exit-node</strong> machine</li>" +
    "<li>Click the <strong>&hellip;</strong> (three dots) menu on its row</li>" +
    "<li>Select <strong>Edit route settings</strong></li>" +
    "<li>Tick <strong>Use as exit node</strong></li>" +
    "<li>Click <strong>Save</strong></li>" +
    "</ol>" +
    '<a href="https://console.tailscale.com/admin/machines" target="_blank" rel="noopener" class="billing-link" style="margin-top:6px;">Open Tailscale Admin &rarr;</a>' +
    "</div>";

  var billingNote =
    '<div class="info-box" style="margin-top:16px;">' +
    "<h4>Set up billing alerts</h4>" +
    '<p style="margin-top:6px;">We recommend setting a spending alert so you are notified if costs exceed what you expect.</p>' +
    '<a href="' +
    prov.billingPage +
    '" target="_blank" rel="noopener" class="billing-link" style="margin-top:10px;">' +
    "Open " +
    prov.displayName +
    " Billing Alerts &rarr;</a></div>";

  var linux = [
    {
      label: "Unzip the package",
      cmd:
        "unzip tailscale-exit-node-" + provider + ".zip -d tailscale-exit-node",
    },
    { label: "Enter the folder", cmd: "cd tailscale-exit-node" },
    { label: "Make the script executable", cmd: "chmod +x deploy.sh" },
    { label: "Run the deploy script", cmd: "./deploy.sh" },
  ];
  var win = [
    {
      label: "Unzip (PowerShell)",
      cmd:
        "Expand-Archive tailscale-exit-node-" +
        provider +
        ".zip -DestinationPath tailscale-exit-node",
    },
    { label: "Enter the folder", cmd: "cd tailscale-exit-node" },
    { label: "Run the deploy script", cmd: ".\\deploy.ps1" },
  ];
  var terraformNote =
    '<div class="info-box" style="margin-bottom:16px;">' +
    "<h4>Install Terraform first</h4>" +
    '<p style="margin-top:6px;">The deploy script needs Terraform installed on your computer. If you don\'t have it yet:</p>' +
    '<ul style="margin-top:8px;padding-left:20px;line-height:1.8;">' +
    "<li><strong>All platforms:</strong> Download from the official site</li>" +
    "<li><strong>macOS:</strong> <code>brew install hashicorp/tap/terraform</code></li>" +
    "<li><strong>Linux (apt):</strong> See the HashiCorp Linux repos</li>" +
    "<li><strong>Windows:</strong> Download the .exe or use <code>choco install terraform</code></li>" +
    "</ul>" +
    '<a href="https://developer.hashicorp.com/terraform/install" target="_blank" rel="noopener" class="billing-link" style="margin-top:12px;">Download Terraform &rarr;</a>' +
    "</div>";

  renderCmdBlocks("linux-commands", linux, "linux");
  renderCmdBlocks("windows-commands", win, "windows");

  // Prepend Terraform install note, then append Tailscale + billing
  el("linux-commands").insertAdjacentHTML("afterbegin", terraformNote);
  el("windows-commands").insertAdjacentHTML("afterbegin", terraformNote);
  el("linux-commands").insertAdjacentHTML(
    "beforeend",
    tailscaleNote + billingNote,
  );
  el("windows-commands").insertAdjacentHTML(
    "beforeend",
    tailscaleNote + billingNote,
  );
}

function renderCmdBlocks(containerId, steps, platform) {
  var html = "";
  for (var i = 0; i < steps.length; i++) {
    var s = steps[i];
    html +=
      '<div class="cmd-block' +
      (s.warn ? " cmd-block-warn" : "") +
      '" id="cmd-' +
      platform +
      "-" +
      i +
      '">' +
      '<div class="cmd-label">' +
      s.label +
      "</div>" +
      '<div class="cmd-row"><code class="cmd-code">' +
      escHtml(s.cmd) +
      "</code>" +
      '<button class="cmd-copy-btn" onclick="copyCmd(\'' +
      platform +
      "'," +
      i +
      ',this)">Copy</button>' +
      "</div></div>";
  }
  el(containerId).innerHTML = html;
}

function escHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function copyCmd(platform, i, btn) {
  var block = el("cmd-" + platform + "-" + i);
  navigator.clipboard
    .writeText(block.querySelector(".cmd-code").textContent)
    .then(function () {
      block.classList.add("cmd-done");
      btn.textContent = "Copied!";
      setTimeout(function () {
        btn.textContent = "Copy";
      }, 2000);
    });
}

function showTab(platform) {
  var tabs = document.querySelectorAll(".tab-btn");
  for (var i = 0; i < tabs.length; i++) tabs[i].classList.remove("active");
  tabs[platform === "linux" ? 0 : 1].classList.add("active");
  el("linux-commands").style.display = platform === "linux" ? "block" : "none";
  el("windows-commands").style.display =
    platform === "windows" ? "block" : "none";
}

// --- Utility -----------------------------------------------------------

function revealCard(cardEl) {
  cardEl.style.display = "block";
  setTimeout(function () {
    cardEl.classList.add("card-visible");
    cardEl.scrollIntoView({ behavior: "smooth", block: "start" });
  }, 30);
}

// --- Theme toggle ------------------------------------------------------

function getMapTileUrl() {
  var isLight = document.body.classList.contains("light-mode");
  var style = isLight ? "light_nolabels" : "dark_nolabels";
  return "https://{s}.basemaps.cartocdn.com/" + style + "/{z}/{x}/{y}{r}.png";
}

function updateMapTiles() {
  if (tileLayer && leafletMap) {
    leafletMap.removeLayer(tileLayer);
    tileLayer = L.tileLayer(getMapTileUrl(), {
      attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: "abcd",
      maxZoom: 19,
      noWrap: true,
    }).addTo(leafletMap);
    // Put tiles behind the geoJSON layer
    tileLayer.bringToBack();
  }
}

(function () {
  var toggle = document.getElementById("theme-toggle");
  var saved = localStorage.getItem("theme");
  if (saved === "light") {
    document.body.classList.add("light-mode");
    toggle.textContent = "\u{1F319}";
  }
  toggle.addEventListener("click", function () {
    document.body.classList.toggle("light-mode");
    var isLight = document.body.classList.contains("light-mode");
    toggle.textContent = isLight ? "\u{1F319}" : "\u{1F31E}";
    localStorage.setItem("theme", isLight ? "light" : "dark");
    updateMapTiles();
  });
})();
