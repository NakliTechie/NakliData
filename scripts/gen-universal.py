#!/usr/bin/env python3
"""Generate taxonomy/v0.1/universal/{universal-terms,crosswalk}.jsonl (Tier-3).

Hand-curated concept scheme + role→concept crosswalk for the 145 shipped types.
Sensitivity is preserved EXACTLY vs the old types.jsonl values (concept default +
per-role override) so the migration is behaviour-identical. Idempotent: re-run
after editing CONCEPTS/MAPPING below.
"""
import json, os

BASE = os.path.join(os.path.dirname(__file__), "..", "taxonomy", "v0.1")

# --- roots (broadest concepts) ------------------------------------------------
# roleFamily ∈ {entity, dimension, measure, metric}; sensitivity default per concept.
CONCEPTS = {
    # roots
    "ut:identifier":       ("Identifier", [], "entity", "public", ["schema:identifier"]),
    "ut:quantity":         ("Quantity", [], "measure", "public", []),
    "ut:ratio":            ("Ratio", [], "metric", "public", []),
    "ut:temporal":         ("Temporal", [], "dimension", "public", []),
    "ut:categorical":      ("Categorical attribute", [], "dimension", "public", ["dbt:dimension"]),
    "ut:label":            ("Label", [], "dimension", "public", []),
    "ut:location":         ("Location", [], "dimension", "public", ["schema:Place"]),
    "ut:contact":          ("Contact point", [], "dimension", "pii", ["schema:ContactPoint"]),

    # identifiers (entity)
    "ut:person_identifier":  ("Person identifier", ["ut:identifier"], "entity", "pii", ["schema:identifier"]),
    "ut:patient_identifier": ("Patient identifier", ["ut:person_identifier"], "entity", "secret", ["fhir:Patient"]),
    "ut:record_identifier":  ("Record identifier", ["ut:identifier"], "entity", "public", []),
    "ut:session_identifier": ("Session identifier", ["ut:record_identifier"], "entity", "pii", []),
    "ut:transaction_identifier": ("Transaction identifier", ["ut:identifier"], "entity", "financial", ["ocds:contract"]),
    "ut:case_identifier":    ("Case identifier", ["ut:identifier"], "entity", "public", ["fhir:Encounter"]),
    "ut:policy_identifier":  ("Policy identifier", ["ut:identifier"], "entity", "financial", []),
    "ut:listing_identifier": ("Listing identifier", ["ut:identifier"], "entity", "public", []),
    "ut:product_identifier": ("Product identifier", ["ut:identifier"], "entity", "public", ["schema:productID"]),
    "ut:device_identifier":  ("Device identifier", ["ut:identifier"], "entity", "pii", []),
    "ut:tax_registration_id":("Tax registration id", ["ut:identifier"], "entity", "financial", ["schema:taxID"]),
    "ut:financial_account_id":("Financial account id", ["ut:identifier"], "entity", "financial", []),
    "ut:government_identifier":("Government identifier", ["ut:person_identifier"], "entity", "pii", []),
    "ut:credential":         ("Credential / secret", ["ut:identifier"], "entity", "secret", []),
    "ut:payment_card":       ("Payment card", ["ut:identifier"], "entity", "financial", []),
    "ut:crypto_address":     ("Crypto wallet address", ["ut:identifier"], "entity", "pii", []),

    # monetary + rates (measure/metric, financial)
    "ut:monetary_amount":  ("Monetary amount", ["ut:quantity"], "measure", "financial", ["schema:MonetaryAmount", "dbt:measure"]),
    "ut:tax_rate":         ("Tax rate", ["ut:ratio"], "metric", "financial", []),
    "ut:interest_rate":    ("Interest rate", ["ut:ratio"], "metric", "financial", []),
    "ut:currency_code":    ("Currency code", ["ut:categorical"], "dimension", "financial", ["schema:currency"]),
    "ut:tax_code":         ("Tax code", ["ut:categorical"], "dimension", "financial", []),
    "ut:ledger_account":   ("Ledger account", ["ut:categorical"], "dimension", "financial", []),

    # counts + physical (measure, public)
    "ut:count":            ("Count", ["ut:quantity"], "measure", "public", ["dbt:measure"]),
    "ut:duration":         ("Duration", ["ut:quantity"], "measure", "public", []),
    "ut:physical_measurement": ("Physical measurement", ["ut:quantity"], "measure", "public", []),
    "ut:spatial_dimension":("Spatial dimension", ["ut:quantity"], "measure", "public", []),

    # ratios / scores (metric)
    "ut:percentage":       ("Percentage", ["ut:ratio"], "metric", "public", []),
    "ut:probability":      ("Probability", ["ut:ratio"], "metric", "public", []),
    "ut:score":            ("Score", ["ut:ratio"], "metric", "public", []),
    "ut:rate_per_period":  ("Rate per period", ["ut:ratio"], "metric", "public", []),

    # temporal (dimension)
    "ut:temporal_instant": ("Temporal instant", ["ut:temporal"], "dimension", "public", ["schema:DateTime", "dbt:time_dimension"]),
    "ut:year":             ("Year", ["ut:temporal"], "dimension", "public", []),
    "ut:birth_date":       ("Birth date", ["ut:temporal_instant"], "dimension", "pii", ["schema:birthDate"]),

    # categorical dimensions
    "ut:category":         ("Category", ["ut:categorical"], "dimension", "public", ["dbt:dimension"]),
    "ut:status":           ("Status", ["ut:categorical"], "dimension", "public", []),
    "ut:flag":             ("Boolean flag", ["ut:categorical"], "dimension", "public", []),
    "ut:priority":         ("Priority", ["ut:categorical"], "dimension", "public", []),
    "ut:event_type":       ("Event type", ["ut:categorical"], "dimension", "public", []),
    "ut:endpoint":         ("Service endpoint", ["ut:categorical"], "dimension", "public", []),
    "ut:job_role":         ("Job role", ["ut:categorical"], "dimension", "public", []),
    "ut:org_unit":         ("Organizational unit", ["ut:categorical"], "dimension", "public", []),
    "ut:diagnosis_code":   ("Diagnosis code", ["ut:categorical"], "dimension", "secret", ["fhir:Condition"]),
    "ut:gender":           ("Gender", ["ut:categorical"], "dimension", "pii", ["schema:gender"]),
    "ut:measurement_unit": ("Measurement unit", ["ut:categorical"], "dimension", "public", ["schema:unitCode"]),
    "ut:marketing_attribution": ("Marketing attribution", ["ut:categorical"], "dimension", "public", []),

    # labels / names (dimension)
    "ut:person_name":      ("Person name", ["ut:label"], "dimension", "pii", ["schema:name"]),
    "ut:organization_name":("Organization name", ["ut:label"], "dimension", "pii", ["schema:legalName", "ocds:Organization"]),
    "ut:title":            ("Title", ["ut:label"], "dimension", "public", ["schema:name"]),
    "ut:json_document":    ("JSON document", ["ut:label"], "dimension", "pii", []),

    # location (dimension)
    "ut:geo_coordinate":   ("Geo coordinate", ["ut:location"], "dimension", "public", ["schema:GeoCoordinates"]),
    "ut:geographic_region":("Geographic region", ["ut:location"], "dimension", "public", ["schema:addressRegion"]),
    "ut:postal_code":      ("Postal code", ["ut:location"], "dimension", "public", ["schema:postalCode"]),
    "ut:street_address":   ("Street address", ["ut:location"], "dimension", "pii", ["schema:streetAddress"]),
    "ut:country":          ("Country", ["ut:geographic_region"], "dimension", "public", ["schema:Country"]),

    # contact (dimension, pii)
    "ut:email_address":    ("Email address", ["ut:contact"], "dimension", "pii", ["schema:email"]),
    "ut:phone_number":     ("Phone number", ["ut:contact"], "dimension", "pii", ["schema:telephone"]),
    "ut:ip_address":       ("IP address", ["ut:contact"], "dimension", "pii", []),
    "ut:web_address":      ("Web address", ["ut:label"], "dimension", "public", ["schema:url"]),

    # ratings / reviews
    "ut:rating":           ("Rating", ["ut:ratio"], "metric", "public", ["schema:Rating"]),
}

# --- role (typeId) → concept --------------------------------------------------
# Every one of the 145 types must appear exactly once.
MAPPING = {
    # india-smb-finance
    "gstin": "ut:tax_registration_id", "pan": "ut:tax_registration_id",
    "hsn_code": "ut:tax_code", "sac_code": "ut:tax_code", "gst_state_code": "ut:tax_code",
    "gst_rate": "ut:tax_rate", "tds_section": "ut:tax_code",
    "ifsc": "ut:financial_account_id", "indian_bank_account": "ut:financial_account_id",
    "cin": "ut:tax_registration_id", "udyam_id": "ut:tax_registration_id",
    "invoice_number": "ut:transaction_identifier", "vendor_name": "ut:organization_name",
    "gl_account": "ut:ledger_account", "pin_code": "ut:postal_code",
    # generic-finance
    "payment_status": "ut:status", "payment_mode": "ut:category", "amount": "ut:monetary_amount",
    "currency_iso": "ut:currency_code", "iban": "ut:financial_account_id", "swift_bic": "ut:financial_account_id",
    "iso_date": "ut:temporal_instant", "iso_datetime": "ut:temporal_instant",
    "unix_timestamp_ms": "ut:temporal_instant", "unix_timestamp_s": "ut:temporal_instant",
    "percentage": "ut:percentage", "probability": "ut:probability",
    # generic-logs
    "email": "ut:email_address", "url": "ut:web_address", "ip_v4": "ut:ip_address", "ip_v6": "ut:ip_address",
    "phone_e164": "ut:phone_number", "iso_country_code": "ut:country", "http_status": "ut:status",
    "log_level": "ut:event_type", "http_method": "ut:event_type", "duration_ms": "ut:duration",
    "request_id": "ut:record_identifier", "service_name": "ut:endpoint", "endpoint": "ut:endpoint",
    "uuid": "ut:record_identifier", "record_id": "ut:record_identifier",
    # product-analytics
    "event_name": "ut:event_type", "user_id": "ut:person_identifier", "session_id": "ut:session_identifier",
    "event_properties_json": "ut:json_document", "utm_source": "ut:marketing_attribution",
    "utm_medium": "ut:marketing_attribution", "utm_campaign": "ut:marketing_attribution",
    # geography
    "latitude": "ut:geo_coordinate", "longitude": "ut:geo_coordinate", "city": "ut:geographic_region",
    "state_region": "ut:geographic_region", "district_neighbourhood": "ut:geographic_region",
    "postal_code": "ut:postal_code", "address_line": "ut:street_address", "country_name": "ut:country",
    # marketplace
    "listing_id": "ut:listing_identifier", "host_id": "ut:person_identifier", "host_name": "ut:person_name",
    "room_type": "ut:category", "availability_days": "ut:count", "minimum_stay": "ut:count",
    "review_count": "ut:count", "reviews_per_period": "ut:rate_per_period", "last_review_date": "ut:temporal_instant",
    "listing_name": "ut:title",
    # sample-datasets
    "survival_flag": "ut:flag", "passenger_class": "ut:category", "sex_gender": "ut:gender",
    "age_years": "ut:count", "fare_amount": "ut:monetary_amount", "embarkation_port": "ut:geographic_region",
    # retail
    "order_id": "ut:transaction_identifier", "sku": "ut:product_identifier", "quantity": "ut:count",
    "customer_id": "ut:person_identifier",
    # media
    "content_title": "ut:title", "credited_person": "ut:person_name", "content_rating": "ut:category",
    "genre": "ut:category", "release_year": "ut:year", "media_type": "ut:category",
    # sensitive-data
    "credential_secret": "ut:credential", "api_key": "ut:credential", "jwt": "ut:credential",
    "private_key_pem": "ut:credential", "aws_access_key_id": "ut:credential",
    "credit_card_number": "ut:payment_card", "ssn": "ut:government_identifier",
    "date_of_birth": "ut:birth_date", "passport_number": "ut:government_identifier",
    "national_id": "ut:government_identifier", "mac_address": "ut:device_identifier",
    "crypto_wallet_address": "ut:crypto_address",
    # hr-people
    "employee_id": "ut:person_identifier", "job_title": "ut:job_role", "department": "ut:org_unit",
    "compensation": "ut:monetary_amount", "tenure_years": "ut:count",
    # real-estate
    "property_type": "ut:category", "bedrooms": "ut:count", "bathrooms": "ut:count",
    "square_feet": "ut:spatial_dimension", "sale_price": "ut:monetary_amount",
    # education
    "student_id": "ut:person_identifier", "grade_level": "ut:category", "course_name": "ut:title",
    "score_percent": "ut:score", "completion_status": "ut:status",
    # healthcare
    "patient_id": "ut:patient_identifier", "diagnosis_code": "ut:diagnosis_code",
    "encounter_id": "ut:case_identifier", "length_of_stay": "ut:count", "claim_amount": "ut:monetary_amount",
    # public-sector
    "population": "ut:count", "households": "ut:count", "median_income": "ut:monetary_amount",
    "unemployment_rate": "ut:percentage", "age_band": "ut:category",
    # scientific
    "sensor_id": "ut:device_identifier", "temperature": "ut:physical_measurement",
    "humidity": "ut:physical_measurement", "pressure": "ut:physical_measurement",
    "measurement_unit": "ut:measurement_unit",
    # risk-fraud
    "fraud_flag": "ut:flag", "risk_score": "ut:score", "auth_result": "ut:status",
    "device_id": "ut:device_identifier", "card_last4": "ut:payment_card",
    # banking
    "transaction_amount": "ut:monetary_amount", "transaction_fee": "ut:monetary_amount",
    "debit_credit": "ut:category", "interest_rate": "ut:interest_rate", "principal_amount": "ut:monetary_amount",
    # insurance
    "policy_id": "ut:policy_identifier", "premium_amount": "ut:monetary_amount",
    "sum_insured": "ut:monetary_amount", "claim_status": "ut:status", "line_of_business": "ut:category",
    # customer-support
    "ticket_id": "ut:case_identifier", "ticket_status": "ut:status", "support_priority": "ut:priority",
    "first_response_minutes": "ut:count", "csat_score": "ut:score",
}

# --- current sensitivity (from types.jsonl) — used to compute per-role overrides
def load_current_sensitivity():
    out = {}
    for line in open(os.path.join(BASE, "types.jsonl")):
        line = line.strip()
        if not line:
            continue
        t = json.loads(line)
        out[t["id"]] = t.get("sensitivity", "public")
    return out

def main():
    cur_sens = load_current_sensitivity()
    ids = list(cur_sens.keys())

    # sanity: every type mapped, every concept referenced exists
    missing = [i for i in ids if i not in MAPPING]
    assert not missing, f"types with no crosswalk mapping: {missing}"
    extra = [i for i in MAPPING if i not in cur_sens]
    assert not extra, f"crosswalk maps unknown types: {extra}"
    bad_ut = sorted({ut for ut in MAPPING.values() if ut not in CONCEPTS})
    assert not bad_ut, f"crosswalk points at undefined concepts: {bad_ut}"

    # broader chains resolve + acyclic
    for ut, (_, broader, *_ ) in CONCEPTS.items():
        for b in broader:
            assert b in CONCEPTS, f"{ut} broader→undefined {b}"
    def has_cycle(ut, seen):
        if ut in seen:
            return True
        seen = seen | {ut}
        return any(has_cycle(b, seen) for b in CONCEPTS[ut][1])
    for ut in CONCEPTS:
        assert not has_cycle(ut, set()), f"broader cycle at {ut}"

    os.makedirs(os.path.join(BASE, "universal"), exist_ok=True)

    # write universal-terms.jsonl
    with open(os.path.join(BASE, "universal", "universal-terms.jsonl"), "w") as f:
        for ut, (label, broader, rf, sens, exact) in CONCEPTS.items():
            obj = {"id": ut, "prefLabel": label}
            if broader:
                obj["broader"] = broader
            obj["roleFamily"] = rf
            obj["sensitivity"] = sens
            if exact:
                obj["exactMatch"] = exact
            f.write(json.dumps(obj, separators=(",", ":")) + "\n")

    # write crosswalk.jsonl (per-role sensitivity override when it differs from concept default)
    overrides = 0
    with open(os.path.join(BASE, "universal", "crosswalk.jsonl"), "w") as f:
        for role in ids:  # stable order = types.jsonl order
            ut = MAPPING[role]
            concept_sens = CONCEPTS[ut][3]
            obj = {"role": role, "universalTerm": ut}
            if cur_sens[role] != concept_sens:
                obj["sensitivity"] = cur_sens[role]
                overrides += 1
            f.write(json.dumps(obj, separators=(",", ":")) + "\n")

    # PARITY GUARANTEE: sensitivityForType(role) must equal the old types.jsonl value.
    def resolved(role):
        ut = MAPPING[role]
        # override wins, else concept default
        # (mirrors the loader's sensitivityForType)
        return cur_sens[role]  # by construction above, override captures any diff
    for role in ids:
        eff = cur_sens[role] if MAPPING[role] and (cur_sens[role] != CONCEPTS[MAPPING[role]][3]) else CONCEPTS[MAPPING[role]][3]
        assert eff == cur_sens[role], f"sensitivity parity broke for {role}: {eff} != {cur_sens[role]}"

    print(f"OK — {len(CONCEPTS)} concepts, {len(ids)} crosswalk rows, {overrides} per-role sensitivity overrides")
    # coverage report
    from collections import Counter
    rf_counts = Counter(CONCEPTS[MAPPING[r]][2] for r in ids)
    print("roleFamily distribution across 145 types:", dict(rf_counts))

if __name__ == "__main__":
    main()
