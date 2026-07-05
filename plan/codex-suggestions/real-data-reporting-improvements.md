# Codex suggestions — real-data reporting improvements

Date: 2026-07-05

Context: browser testing on `https://naklidata.naklitechie.com/` with Kaggle-known public CSV mirrors:

- Small: Titanic (`891` rows) via `datasciencedojo/datasets`.
- Larger: NYC Airbnb 2019 (`48,895` rows) via `4GeeksAcademy/data-preprocessing-project-tutorial`.

Both mounted and queried cleanly. The main gaps were not engine reliability; they were semantic coverage and report assembly.

## Summary

NakliData's engine claims held up for real analyst work: public CSV mounting, DuckDB querying, schema inspection, local persistence, and result tables all worked on the hosted app with no console errors.

The gaps for an analyst preparing material for senior staff:

1. Semantic taxonomy is too narrow outside the current finance/logs/product-analytics core.
2. Suggested reports depend on recognized semantic shapes, so non-finance datasets often show no suggestions even when obvious report cuts exist.
3. Report cells are currently a blank printable shell, not a guided transformation from result cells into a staff-ready report.
4. The hosted app sends COOP/COEP headers, but the in-app browser still reported `crossOriginIsolated=false`; verify R/WebR in a normal Chrome tab before relying on hosted R cells.
5. Reload restores sources and notebook cells, but not result outputs; analysts need clearer rerun status and a one-click "refresh report" path.

## Will taxonomy expansion fix the first point?

Yes, partially.

Taxonomy expansion will improve:

- Column recognition.
- Sensitivity labels.
- Quick chart suggestions.
- Template/report eligibility.
- Natural language SQL grounding.
- Sink gating, especially anonymized exports and golden-table workflows.

Taxonomy alone will not fix:

- Blank report-cell UX.
- Lack of executive KPI/narrative scaffolding.
- Chart/report composition.
- Persistence of result snapshots.
- Hosted R/WebR isolation verification.

The right fix is two-track:

1. Add broad, domain-aware taxonomy types.
2. Pair each domain with report templates and report-cell composition presets.

## External source pull-in

Use external taxonomies as feeders, not as NakliData's product taxonomy directly. NakliData needs report roles: "what is this column good for in an analyst workflow?" Most external standards either describe web entities, data-package metadata, governance tags, or deep vertical schemas. They are still useful, but each needs a mapping layer.

Recommended pulls:

- **Schema.org** (`https://schema.org/docs/schemas.html`) — pull general entity vocabulary: Person, Organization, Place, Product, Offer, Event, CreativeWork, Review, Rating, JobPosting, Dataset. Use this to strengthen cross-domain identifiers and public web-style datasets.
- **Dublin Core / DCAT** (`https://www.dublincore.org/documents/dcmi-terms/`, `https://www.w3.org/TR/vocab-dcat-3/`) — pull dataset/resource metadata roles: title, description, creator, publisher, license, rights, distribution, access URL, media type, spatial/temporal coverage. Use this for dataset provenance blocks and report footnotes.
- **Frictionless Table Schema** (`https://frictionlessdata.io/specs/table-schema/`) — pull field-level structural metadata: type, format, constraints, missing values, primary keys, foreign keys. Use this for role-specific validation and export manifests.
- **OpenMetadata governance** (`https://openmetadatastandards.org/governance/overview/`) — pull the distinction between glossary terms and classification tags. NakliData should keep semantic role, sensitivity, and quality/status tags separate internally.
- **Microsoft Purview SIT / Google Sensitive Data Protection / Presidio** (`https://learn.microsoft.com/en-us/purview/sit-sensitive-information-type-entity-definitions`, `https://docs.cloud.google.com/sensitive-data-protection/docs/infotypes-reference`, `https://data-privacy-stack.github.io/presidio/supported_entities/`) — pull PII/secret/credential detector families. This is the biggest gap in the current list.
- **dbt Semantic Layer** (`https://docs.getdbt.com/docs/build/semantic-models`) — pull the entity / dimension / time dimension / measure / metric split. NakliData report templates should key off these meta-roles before vertical roles.
- **Great Expectations** (`https://greatexpectations.io/expectations/`) — pull role-aware data-quality assertions: uniqueness, nullability, ranges, accepted sets, freshness, regex conformance.
- **OpenLineage** (`https://openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet/`) — pull column lineage, input/output dataset stats, quality assertions, and quality metrics for refresh/provenance/report trust.
- **FHIR** (`https://www.hl7.org/fhir/resourcelist.html`) — pull healthcare entities only when a healthcare pack is explicitly enabled: Patient, Encounter, Observation, Condition, Procedure, Medication, Claim, Coverage.
- **ISO 20022** (`https://www.iso20022.org/iso-20022-message-definitions`) — pull payment/banking concepts: debtor, creditor, account, remittance, clearing, settlement, mandate, charge, balance, statement.
- **Open Contracting Data Standard** (`https://standard.open-contracting.org/latest/en/schema/reference/`) — pull procurement/government contracting roles: planning, tender, award, contract, implementation, buyer, supplier, value, milestone.
- **Darwin Core** (`https://dwc.tdwg.org/terms/`) — pull biodiversity and field-observation roles: occurrence, taxon, event, location, identification, measurement/fact.
- **GoodRelations** (`https://www.heppnetz.de/ontologies/goodrelations/v1.html`) — pull commerce roles: business entity, offering, price specification, payment method, delivery method, warranty, opening hours.
- **Open Referral HSDS** (`https://docs.openreferral.org/en/latest/hsds/schema_reference.html`) — pull human/social-service directory roles: organization, service, location, contact, eligibility, schedule, taxonomy term.

Comparison to the current compiled list:

- Current list is stronger on analyst/report usefulness than the external standards because it already pairs column roles with report templates.
- Current list is weaker on PII/secret coverage; use Purview/GCP/Presidio.
- Current list is weaker on dataset provenance; use Dublin Core/DCAT/OpenLineage.
- Current list is weaker on explicit semantic-model primitives; use dbt.
- Current list is weaker on quality assertions; use Great Expectations.
- Current list is only a sketch for healthcare, payments, contracting, biodiversity, commerce, and human services; use FHIR, ISO 20022, OCDS, Darwin Core, GoodRelations, and HSDS for future deep packs.

Suggested internal model after the pull-in:

- `semantic_role`: what the column means (`customer_id`, `publication_year`, `claim_amount`).
- `role_family`: entity / dimension / time_dimension / measure / metric / free_text / geography / credential / quality.
- `domain_pack`: generic, finance, logs, marketplace, healthcare, public-sector, etc.
- `sensitivity`: public / pii / financial / secret.
- `quality_profile`: nullable, uniqueness, accepted set, range, pattern, freshness.
- `provenance_role`: source URL, dataset title, publisher, license, distribution, lineage inputs.
- `report_affordances`: eligible templates, default chart, default KPI, default aggregation.

## Comprehensive taxonomy backlog

Add these as new taxonomy types, domain files, and report-template eligibility rules. Keep the current detector model: header-match first, then value-set/range/regex/distribution evidence. Use explicit `sensitivity` on every type.

### Cross-domain identifiers

- `record_id`: `id`, `record_id`, `row_id`, `listing_id`, `passenger_id`, `order_id`, `ticket_id`; high-cardinality IDs; sensitivity public unless person-linked.
- `entity_id`: `entity_id`, `object_id`, `resource_id`, `asset_id`; high-cardinality; public/pii depending domain.
- `person_name`: `name`, `full_name`, `customer_name`, `passenger_name`, `host_name`, `employee_name`; PII.
- `first_name`: `first_name`, `given_name`; PII.
- `last_name`: `last_name`, `surname`, `family_name`; PII.
- `organization_name`: `company`, `company_name`, `org`, `organization`, `employer`, `school`, `institution`; public/financial depending domain.
- `category`: `category`, `segment`, `class`, `type`, `group`; low-cardinality string; public.
- `subcategory`: `subcategory`, `sub_category`, `subtype`; public.
- `status`: `status`, `state`, `stage`; low-cardinality; public unless finance-specific.
- `rank`: `rank`, `position`, `place`; numeric small positive; public.
- `score`: `score`, `rating_score`, `quality_score`; numeric; public.
- `flag_boolean`: `flag`, `is_*`, `has_*`, `active`, `enabled`; boolean/value-set true/false/yes/no/0/1; public.
- `free_text`: `description`, `notes`, `comment`, `review`, `summary`, `body`, `message`; sensitivity unknown/pii by default.

### Geography and location

This would have helped the Airbnb dataset.

- `latitude`: `lat`, `latitude`; numeric range `-90..90`; public.
- `longitude`: `lon`, `lng`, `longitude`; numeric range `-180..180`; public.
- `coordinate_pair`: `coordinates`, `lat_lon`, `location`; regex or JSON-ish values; public.
- `city`: `city`, `town`, `municipality`; public.
- `state_region`: `state`, `region`, `province`, `territory`, `neighbourhood_group`; public.
- `district_neighbourhood`: `district`, `neighborhood`, `neighbourhood`, `ward`, `borough`, `zone`; public.
- `postal_code`: `zip`, `zipcode`, `postal_code`, `post_code`, `pin_code`; public.
- `country_name`: `country`, `country_name`; public.
- `address_line`: `address`, `street`, `street_address`, `addr`; PII.
- `geo_area_name`: `area`, `market`, `metro`, `msa`, `locality`; public.

Report templates:

- Listings/records by geography.
- Price/amount by geography.
- Availability/capacity by geography.
- Choropleth/map recommendation when latitude+longitude or geo names exist.

### Marketplace / listings

This would have helped Airbnb generate suggestions.

- `listing_id`: `listing_id`, `id`, `property_id`, `unit_id`; public.
- `listing_name`: `name`, `listing_name`, `title`; public or PII if host-entered.
- `host_id`: `host_id`, `seller_id`, `owner_id`, `provider_id`; PII/public depending domain.
- `host_name`: `host_name`, `seller_name`, `owner_name`, `provider_name`; PII.
- `room_type`: `room_type`, `unit_type`, `property_type`, `space_type`; value-set `Entire home/apt`, `Private room`, `Shared room`, hotel/house/apartment variants; public.
- `price`: already covered by `amount`, but add marketplace-specific alias type or subtype for `price`, `nightly_price`, `daily_rate`, `list_price`, `rent`; financial.
- `availability_days`: `availability_365`, `availability`, `available_days`, `days_available`; numeric `0..366`; public.
- `minimum_stay`: `minimum_nights`, `min_nights`, `minimum_stay`, `min_stay`; numeric positive; public.
- `review_count`: `number_of_reviews`, `reviews`, `review_count`, `num_reviews`; numeric nonnegative; public.
- `reviews_per_period`: `reviews_per_month`, `review_rate`, `reviews_per_week`; numeric nonnegative; public.
- `last_review_date`: `last_review`, `last_review_date`, `review_date`; date; public.
- `license_id`: `license`, `license_number`, `permit_number`; public/financial depending context.

Report templates:

- Supply mix by geography and listing type.
- Price distribution by geography and listing type.
- Availability and minimum-stay constraints.
- Review activity and freshness.
- Host concentration / top hosts.
- Outlier listings: high price, low availability, suspicious minimum nights.

### Hospitality / travel

Useful for Airbnb, hotels, flights, tourism datasets.

- `booking_id`: `booking_id`, `reservation_id`, `pnr`; PII/secret depending content.
- `guest_id`: `guest_id`, `traveller_id`, `traveler_id`; PII.
- `checkin_date`: `checkin`, `check_in`, `arrival_date`; PII/public depending dataset.
- `checkout_date`: `checkout`, `check_out`, `departure_date`; PII/public depending dataset.
- `nights`: `nights`, `stay_length`, `length_of_stay`; numeric positive.
- `occupancy_rate`: `occupancy`, `occupancy_rate`; percentage.
- `adr`: `adr`, `average_daily_rate`, `daily_rate`; financial.
- `revpar`: `revpar`, `revenue_per_available_room`; financial.
- `cancellation_status`: `is_canceled`, `cancelled`, `cancellation_status`; boolean/status.
- `booking_channel`: `channel`, `market_segment`, `distribution_channel`; public.

Report templates:

- Occupancy and revenue trend.
- Cancellation drivers.
- Segment/channel mix.
- Stay length distribution.

### Passenger / survival / public sample datasets

This would have helped Titanic produce report suggestions.

- `passenger_id`: `passenger_id`, `PassengerId`, `traveller_id`; PII/public depending source.
- `survival_flag`: `survived`, `survival`, `is_survived`, `outcome`; boolean/value-set 0/1; public.
- `passenger_class`: `pclass`, `passenger_class`, `ticket_class`, `cabin_class`, `class`; low-cardinality 1/2/3 or labels; public.
- `sex_gender`: `sex`, `gender`; value-set male/female/other variants; PII.
- `age_years`: `age`, `age_years`; numeric `0..125`; PII.
- `fare_amount`: `fare`, `ticket_fare`, `price_paid`; financial.
- `ticket_number`: `ticket`, `ticket_no`, `ticket_number`; PII/financial.
- `cabin`: `cabin`, `room`, `berth`; PII/public depending source.
- `embarkation_port`: `embarked`, `port`, `origin_port`, `departure_port`; public.
- `family_count`: `sibsp`, `siblings_spouses`, `parch`, `parents_children`, `family_size`; PII-ish aggregate.

Report templates:

- Outcome/survival by demographic and class.
- Fare distribution by class.
- Missingness/quality audit for demographic fields.
- Cohort comparisons.

### Retail / orders / Superstore

- `order_id`: `order_id`, `order_number`, `ord_no`; financial.
- `order_date`: `order_date`, `purchased_at`, `sale_date`; financial/public.
- `ship_date`: `ship_date`, `fulfilled_at`, `delivery_date`; public/financial.
- `ship_mode`: `ship_mode`, `shipping_method`, `delivery_method`; public.
- `customer_id`: `customer_id`, `buyer_id`, `client_id`; PII.
- `customer_name`: `customer`, `customer_name`, `buyer_name`, `client_name`; PII.
- `customer_segment`: `segment`, `customer_segment`, `market_segment`; public.
- `product_id`: `product_id`, `sku`, `item_id`; public/financial.
- `product_name`: `product`, `product_name`, `item_name`; public.
- `product_category`: `category`, `product_category`, `department`; public.
- `product_subcategory`: `subcategory`, `sub_category`; public.
- `quantity`: `quantity`, `qty`, `units`, `unit_count`; public/financial.
- `discount`: `discount`, `discount_rate`, `markdown`; financial.
- `sales_amount`: `sales`, `revenue`, `gross_sales`; financial.
- `profit_amount`: `profit`, `gross_profit`, `net_profit`, `margin_value`; financial.
- `margin_pct`: `margin`, `profit_margin`, `gross_margin`; financial.
- `return_flag`: `returned`, `is_returned`, `return_status`; financial.

Report templates:

- Revenue/profit by segment, region, category.
- Margin leakage / discount impact.
- Top and bottom products/customers.
- Fulfillment delay report.
- Return-rate report.

### Marketing and growth

- `campaign_id`: `campaign_id`, `ad_campaign_id`; public/financial.
- `campaign_name`: already partial via `utm_campaign`; extend aliases.
- `channel`: `channel`, `marketing_channel`, `source_medium`; public.
- `impressions`: `impressions`, `views`; public.
- `clicks`: `clicks`, `click_count`; public.
- `spend`: `spend`, `ad_spend`, `media_cost`, `cost`; financial.
- `cpc`: `cpc`, `cost_per_click`; financial.
- `cpm`: `cpm`, `cost_per_mille`; financial.
- `ctr`: `ctr`, `click_through_rate`; percentage.
- `conversions`: `conversions`, `orders`, `leads`; public/financial.
- `conversion_rate`: `conversion_rate`, `cvr`; percentage.
- `cac`: `cac`, `customer_acquisition_cost`; financial.
- `roas`: `roas`, `return_on_ad_spend`; financial/percentage.

Report templates:

- Spend and ROAS by channel/campaign.
- Funnel from impressions to conversion.
- Cost efficiency outliers.

### Product analytics and SaaS

Extend current product analytics domain.

- `account_id`: `account_id`, `workspace_id`, `tenant_id`, `org_id`; PII/financial.
- `plan_name`: `plan`, `plan_name`, `subscription_plan`, `tier`; financial.
- `subscription_status`: `subscription_status`, `account_status`, `lifecycle_status`; financial.
- `mrr`: `mrr`, `monthly_recurring_revenue`; financial.
- `arr`: `arr`, `annual_recurring_revenue`; financial.
- `churn_flag`: `churned`, `is_churned`, `cancelled`; financial.
- `churn_date`: `churn_date`, `cancelled_at`; financial.
- `signup_date`: `signup_date`, `registered_at`, `created_at`; PII/public.
- `activation_date`: `activation_date`, `activated_at`; public.
- `feature_name`: `feature`, `feature_name`; public.
- `workspace_seats`: `seats`, `seat_count`, `users_count`; financial.
- `usage_count`: `usage`, `events`, `actions`, `api_calls`; public/financial.

Report templates:

- Activation funnel.
- Retention/churn by plan/cohort.
- Usage by account and feature.
- MRR/ARR movement.

### Healthcare and clinical data

Only if product scope wants general analyst datasets; mark sensitivity carefully.

- `patient_id`: `patient_id`, `mrn`, `member_id`; secret/PII.
- `diagnosis_code`: `icd10`, `diagnosis_code`, `dx_code`; secret.
- `procedure_code`: `cpt`, `procedure_code`; secret.
- `encounter_id`: `encounter_id`, `visit_id`; secret.
- `admission_date`: `admission_date`, `admitted_at`; secret.
- `discharge_date`: `discharge_date`, `discharged_at`; secret.
- `length_of_stay`: `los`, `length_of_stay`; secret.
- `payer`: `payer`, `insurance`, `insurer`; secret/financial.
- `claim_amount`: `claim_amount`, `allowed_amount`, `paid_amount`; financial/secret.
- `lab_value`: `lab_value`, `result_value`; secret.

Report templates:

- Claims spend by payer/diagnosis.
- Length of stay trends.
- Readmission/care-gap flags.

### Education

- `student_id`: `student_id`, `learner_id`; PII.
- `school_id`: `school_id`, `institution_id`; public.
- `grade_level`: `grade`, `grade_level`, `class_level`; PII/public.
- `course_id`: `course_id`, `subject_id`; public.
- `course_name`: `course`, `subject`; public.
- `score_percent`: `score`, `marks`, `grade_score`, `percentage`; PII.
- `attendance_rate`: `attendance`, `attendance_rate`; PII.
- `enrollment_date`: `enrolled_at`, `enrollment_date`; PII.
- `completion_status`: `completed`, `completion_status`, `passed`; PII.

Report templates:

- Performance by grade/course.
- Attendance risk.
- Completion funnel.

### HR / people operations

- `employee_id`: `employee_id`, `emp_id`; PII.
- `employee_name`: `employee`, `employee_name`; PII.
- `department`: `department`, `team`, `function`; public/PII.
- `job_title`: `title`, `job_title`, `role`; PII.
- `manager_id`: `manager_id`, `supervisor_id`; PII.
- `hire_date`: `hire_date`, `start_date`; PII.
- `termination_date`: `termination_date`, `end_date`; PII.
- `salary_amount`: `salary`, `compensation`, `base_pay`; secret.
- `performance_rating`: `performance_rating`, `rating`; secret.
- `attrition_flag`: `attrition`, `left_company`, `terminated`; secret.

Report templates:

- Headcount by department/location.
- Attrition risk and trend.
- Compensation distribution.

### Real estate

- `property_id`: `property_id`, `parcel_id`, `listing_id`; public.
- `property_type`: `property_type`, `home_type`, `building_type`; public.
- `bedrooms`: `bedrooms`, `beds`, `bed_count`; public.
- `bathrooms`: `bathrooms`, `baths`, `bath_count`; public.
- `square_feet`: `sqft`, `square_feet`, `area_sqft`; public.
- `lot_size`: `lot_size`, `land_area`; public.
- `sale_price`: `sale_price`, `price`, `closing_price`; financial.
- `rent_amount`: `rent`, `monthly_rent`; financial.
- `listing_date`: `listing_date`, `listed_at`; public.
- `days_on_market`: `days_on_market`, `dom`; public.

Report templates:

- Price per sqft by geography.
- Inventory and days-on-market.
- Rent/sale comparison.

### Risk, fraud, and security

- `risk_score`: `risk_score`, `fraud_score`, `threat_score`; secret.
- `fraud_flag`: `fraud`, `is_fraud`, `chargeback`, `suspicious`; secret/financial.
- `transaction_id`: `transaction_id`, `txn_id`; financial.
- `merchant_id`: `merchant_id`, `merchant`; financial.
- `card_last4`: `last4`, `card_last4`; financial/secret.
- `auth_result`: `auth_result`, `authorization_status`; financial.
- `device_id`: `device_id`, `fingerprint_id`; PII/secret.
- `geo_velocity`: `geo_velocity`, `distance_from_last`; secret.

Report templates:

- Fraud rate by merchant/channel.
- High-risk transaction queue.
- Chargeback trend.

### Public sector / demographics

- `population`: `population`, `pop`; public.
- `households`: `households`, `hh_count`; public.
- `median_income`: `median_income`, `income`; public/financial aggregate.
- `unemployment_rate`: `unemployment`, `unemployment_rate`; public.
- `poverty_rate`: `poverty_rate`; public.
- `age_band`: `age_group`, `age_band`, `age_bucket`; public.
- `race_ethnicity`: `race`, `ethnicity`; sensitive aggregate.
- `gender_aggregate`: `gender`, `sex`; sensitive aggregate.

Report templates:

- Demographic distribution by geography.
- Socioeconomic trend.
- Program coverage and gaps.

### Scientific / measurements

- `measurement_id`: `measurement_id`, `sample_id`; public.
- `sensor_id`: `sensor_id`, `station_id`; public.
- `measurement_time`: `measured_at`, `timestamp`, `sample_time`; public.
- `temperature`: `temperature`, `temp`, `temp_c`, `temp_f`; public.
- `humidity`: `humidity`, `rh`; public.
- `pressure`: `pressure`, `barometric_pressure`; public.
- `speed`: `speed`, `velocity`; public.
- `distance`: `distance`, `length`; public.
- `weight`: `weight`, `mass`; public.
- `unit`: `unit`, `units`, `uom`; public.

Report templates:

- Time-series trend.
- Sensor outliers.
- Distribution and quality audit.

### Supply chain, procurement, and inventory

- `purchase_order_id`: `po_number`, `po_no`, `purchase_order`, `purchase_order_id`; financial.
- `requisition_id`: `requisition`, `req_id`, `purchase_request`; financial.
- `supplier_id`: `supplier_id`, `vendor_id`, `seller_id`; financial/PII depending source.
- `supplier_name`: `supplier`, `supplier_name`, `vendor`, `vendor_name`; financial/PII.
- `buyer_id`: `buyer_id`, `requester_id`, `purchaser_id`; PII.
- `warehouse_id`: `warehouse_id`, `dc_id`, `fulfillment_center`; public/financial.
- `warehouse_name`: `warehouse`, `dc_name`, `fulfillment_center_name`; public.
- `sku`: `sku`, `item_sku`, `material_code`, `part_number`; public/financial.
- `item_description`: `item_description`, `material_description`, `description`; public/financial.
- `inventory_quantity`: `inventory`, `stock_on_hand`, `on_hand_qty`, `qty_available`; financial.
- `reorder_point`: `reorder_point`, `min_stock`, `safety_stock`; financial.
- `lead_time_days`: `lead_time`, `lead_time_days`, `supplier_lead_time`; financial.
- `unit_cost`: `unit_cost`, `standard_cost`, `landed_cost`; financial.
- `shipment_id`: `shipment_id`, `load_id`, `tracking_id`; financial/PII.
- `carrier_name`: `carrier`, `carrier_name`, `shipper`; public/financial.
- `delivery_status`: `delivery_status`, `fulfillment_status`, `shipment_status`; public/financial.
- `eta_date`: `eta`, `estimated_delivery`, `expected_arrival`; public/financial.
- `received_date`: `received_date`, `grn_date`, `goods_receipt_date`; financial.

Report templates:

- Supplier spend and concentration.
- Inventory stockout risk.
- Lead-time and fulfilment SLA.
- Purchase order aging.
- Warehouse inventory health.

### Banking, payments, and lending

- `transaction_id`: `transaction_id`, `txn_id`, `payment_id`, `transfer_id`; financial.
- `account_id`: `account_id`, `acct_id`, `wallet_id`; financial/secret.
- `counterparty_id`: `counterparty_id`, `beneficiary_id`, `merchant_id`; financial.
- `counterparty_name`: `counterparty`, `beneficiary`, `merchant`, `merchant_name`; financial/PII.
- `debit_credit`: `debit_credit`, `dr_cr`, `transaction_type`; value-set debit/credit/dr/cr; financial.
- `transaction_amount`: `transaction_amount`, `txn_amount`, `amount`; financial.
- `transaction_fee`: `fee`, `transaction_fee`, `processing_fee`; financial.
- `balance_amount`: `balance`, `closing_balance`, `available_balance`; financial/secret.
- `loan_id`: `loan_id`, `application_id`, `credit_id`; financial/secret.
- `principal_amount`: `principal`, `principal_amount`, `loan_amount`; financial/secret.
- `interest_rate`: `interest_rate`, `apr`, `rate`; financial.
- `tenure_months`: `tenure`, `loan_term`, `term_months`; financial.
- `delinquency_status`: `delinquency`, `dpd_bucket`, `past_due_status`; financial/secret.
- `days_past_due`: `dpd`, `days_past_due`; financial/secret.
- `credit_score`: `credit_score`, `bureau_score`, `risk_score`; secret.
- `kyc_status`: `kyc_status`, `verification_status`; secret/PII.

Report templates:

- Transaction volume/value by counterparty and channel.
- Delinquency aging.
- Loan book performance.
- Fee leakage and payment failures.
- High-risk account queue.

### Insurance

- `policy_id`: `policy_id`, `policy_number`, `pol_no`; secret/financial.
- `claim_id`: `claim_id`, `claim_number`; secret/financial.
- `insured_id`: `insured_id`, `member_id`, `policyholder_id`; PII/secret.
- `insured_name`: `insured_name`, `policyholder`, `member_name`; PII/secret.
- `premium_amount`: `premium`, `premium_amount`, `gross_premium`; financial.
- `sum_insured`: `sum_insured`, `coverage_amount`, `limit_amount`; financial/secret.
- `claim_amount`: `claim_amount`, `loss_amount`, `paid_loss`; financial/secret.
- `claim_status`: `claim_status`, `settlement_status`; secret/financial.
- `policy_start_date`: `policy_start`, `effective_date`, `inception_date`; secret/financial.
- `policy_end_date`: `policy_end`, `expiry_date`, `expiration_date`; secret/financial.
- `loss_date`: `loss_date`, `incident_date`; secret.
- `line_of_business`: `lob`, `line_of_business`, `product_line`; financial.
- `agent_broker`: `agent`, `broker`, `producer`; financial/PII.

Report templates:

- Claims severity and frequency.
- Loss ratio by product/region.
- Policy renewal pipeline.
- Open claims aging.

### Energy, utilities, and infrastructure

- `meter_id`: `meter_id`, `smart_meter_id`, `asset_meter`; PII/public depending granularity.
- `customer_account`: `customer_account`, `utility_account`, `consumer_no`; PII/financial.
- `usage_kwh`: `usage_kwh`, `consumption_kwh`, `energy_kwh`; financial/PII.
- `demand_kw`: `demand_kw`, `peak_kw`, `max_demand`; financial/PII.
- `billing_period`: `billing_period`, `bill_month`, `cycle`; financial.
- `tariff_code`: `tariff`, `rate_plan`, `tariff_code`; financial.
- `outage_id`: `outage_id`, `incident_id`; public/operational.
- `outage_minutes`: `outage_minutes`, `downtime_minutes`, `duration_minutes`; public/operational.
- `asset_id`: `asset_id`, `transformer_id`, `feeder_id`, `plant_id`; public/operational.
- `asset_type`: `asset_type`, `equipment_type`; public.
- `maintenance_status`: `maintenance_status`, `work_order_status`; operational.
- `emissions_amount`: `co2e`, `emissions`, `carbon_emissions`; public/financial.

Report templates:

- Consumption trend and demand peaks.
- Outage reliability brief.
- Asset maintenance backlog.
- Emissions and efficiency report.

### Manufacturing and quality

- `work_order_id`: `work_order`, `wo_id`, `production_order`; financial/operational.
- `batch_id`: `batch_id`, `lot_id`, `lot_number`; operational.
- `line_id`: `line_id`, `production_line`, `station_id`; operational.
- `machine_id`: `machine_id`, `equipment_id`; operational.
- `operator_id`: `operator_id`, `employee_id`; PII.
- `product_code`: `product_code`, `material_code`, `sku`; public/financial.
- `produced_quantity`: `produced_qty`, `output_qty`, `units_produced`; operational.
- `defect_count`: `defects`, `defect_count`, `rejects`; operational.
- `yield_rate`: `yield`, `yield_rate`, `first_pass_yield`; public/operational.
- `scrap_amount`: `scrap`, `scrap_qty`, `scrap_cost`; financial/operational.
- `downtime_minutes`: `downtime`, `downtime_minutes`; operational.
- `quality_result`: `quality_result`, `inspection_result`, `pass_fail`; operational.
- `spec_limit_lower`: `lsl`, `lower_spec_limit`; operational.
- `spec_limit_upper`: `usl`, `upper_spec_limit`; operational.

Report templates:

- Production yield and defect trend.
- Downtime Pareto.
- Batch quality outliers.
- Scrap cost report.

### Customer support and success

- `ticket_id`: `ticket_id`, `case_id`, `support_id`; PII/operational.
- `customer_id`: `customer_id`, `account_id`, `client_id`; PII/financial.
- `agent_id`: `agent_id`, `assignee_id`, `owner_id`; PII.
- `ticket_subject`: `subject`, `ticket_subject`, `case_title`; PII possible.
- `ticket_status`: `ticket_status`, `case_status`, `status`; operational.
- `priority`: `priority`, `severity`, `urgency`; public/operational.
- `created_at`: `created_at`, `opened_at`, `submitted_at`; public/operational.
- `resolved_at`: `resolved_at`, `closed_at`; public/operational.
- `first_response_minutes`: `first_response_time`, `first_response_minutes`; operational.
- `resolution_minutes`: `resolution_time`, `time_to_resolve`, `resolution_minutes`; operational.
- `csat_score`: `csat`, `satisfaction`, `customer_satisfaction`; PII/operational.
- `nps_score`: `nps`, `net_promoter_score`; PII/operational.
- `topic_label`: `topic`, `issue_type`, `category`; public/operational.

Report templates:

- SLA breach report.
- Support volume by topic and priority.
- Agent/team workload.
- CSAT/NPS trend.

### Legal, contracts, and compliance

- `contract_id`: `contract_id`, `agreement_id`, `msa_id`; secret/financial.
- `counterparty_name`: `counterparty`, `vendor`, `customer`, `party_name`; PII/financial.
- `contract_type`: `contract_type`, `agreement_type`; financial/secret.
- `effective_date`: `effective_date`, `start_date`, `commencement_date`; financial/secret.
- `expiration_date`: `expiration_date`, `end_date`, `renewal_date`; financial/secret.
- `contract_value`: `contract_value`, `total_contract_value`, `tcv`; financial/secret.
- `renewal_status`: `renewal_status`, `auto_renewal`, `renewal`; financial.
- `obligation_id`: `obligation_id`, `control_id`, `requirement_id`; secret.
- `compliance_status`: `compliance_status`, `control_status`, `finding_status`; secret.
- `risk_rating`: `risk_rating`, `risk_level`, `severity`; secret.
- `audit_finding`: `finding`, `audit_finding`, `issue`; secret.

Report templates:

- Contract renewal pipeline.
- Contract value by counterparty/type.
- Compliance findings aging.
- High-risk obligations.

### Media, content, and publishing

- `content_id`: `content_id`, `post_id`, `article_id`, `video_id`; public.
- `title`: `title`, `headline`, `content_title`; public.
- `author_id`: `author_id`, `creator_id`; PII/public.
- `author_name`: `author`, `creator`, `writer`; PII/public.
- `publish_date`: `publish_date`, `published_at`, `release_date`; public.
- `content_type`: `content_type`, `format`, `asset_type`; public.
- `views`: `views`, `pageviews`, `impressions`; public.
- `watch_time_seconds`: `watch_time`, `watch_seconds`, `view_duration`; public/financial.
- `engagement_count`: `engagements`, `likes`, `shares`, `comments`; public.
- `ctr`: `ctr`, `click_through_rate`; public.
- `revenue_amount`: `revenue`, `ad_revenue`, `creator_revenue`; financial.

Report templates:

- Content performance leaderboard.
- Engagement and revenue trend.
- Author/channel contribution.

### Agriculture and food systems

- `farm_id`: `farm_id`, `plot_id`, `field_id`; public/financial.
- `crop_type`: `crop`, `crop_type`, `commodity`; public.
- `season`: `season`, `crop_season`, `harvest_season`; public.
- `planting_date`: `planting_date`, `sowing_date`; public.
- `harvest_date`: `harvest_date`; public.
- `yield_amount`: `yield`, `yield_kg`, `yield_tonnes`; financial/public.
- `acreage`: `acreage`, `area_acres`, `hectares`; public.
- `rainfall_mm`: `rainfall`, `rainfall_mm`; public.
- `fertilizer_amount`: `fertilizer`, `fertilizer_kg`; financial/public.
- `market_price`: `market_price`, `commodity_price`; financial.

Report templates:

- Yield by crop/region/season.
- Input cost and market price trend.
- Weather impact brief.

### Sports and events

- `match_id`: `match_id`, `game_id`, `event_id`; public.
- `team_id`: `team_id`, `club_id`; public.
- `team_name`: `team`, `team_name`, `club`; public.
- `player_id`: `player_id`, `athlete_id`; PII/public.
- `player_name`: `player`, `player_name`, `athlete`; PII/public.
- `event_date`: `match_date`, `game_date`, `event_date`; public.
- `score_for`: `score_for`, `points_for`, `runs_for`, `goals_for`; public.
- `score_against`: `score_against`, `points_against`, `runs_against`, `goals_against`; public.
- `attendance_count`: `attendance`, `crowd`, `spectators`; public.
- `venue_name`: `venue`, `stadium`, `arena`; public.
- `win_loss_result`: `result`, `outcome`, `win_loss`; public.

Report templates:

- Performance by team/player/venue.
- Attendance and revenue brief.
- Win/loss trend.

### Nonprofit and fundraising

- `donor_id`: `donor_id`, `supporter_id`, `constituent_id`; PII.
- `donor_name`: `donor`, `donor_name`, `supporter_name`; PII.
- `donation_id`: `donation_id`, `gift_id`, `contribution_id`; financial/PII.
- `donation_amount`: `donation`, `gift_amount`, `contribution_amount`; financial/PII.
- `donation_date`: `donation_date`, `gift_date`; financial/PII.
- `campaign_name`: `campaign`, `appeal`, `fundraiser`; public/financial.
- `fund_name`: `fund`, `restricted_fund`, `program`; financial.
- `recurring_flag`: `recurring`, `monthly_donor`, `is_recurring`; financial/PII.
- `pledge_amount`: `pledge`, `pledge_amount`; financial/PII.
- `grant_id`: `grant_id`, `award_id`; financial.

Report templates:

- Fundraising by campaign/fund.
- Donor retention and recurring giving.
- Pledge pipeline.

### Research, scholarly, and knowledge graphs

The Parquet `papers` test exposed this gap.

- `paper_id`: `paper_id`, `pid`, `doi`, `work_id`, `publication_id`; public.
- `doi`: `doi`, `digital_object_identifier`; public.
- `paper_title`: `title`, `ttl`, `paper_title`, `article_title`; public.
- `abstract_text`: `abstract`, `abs`, `summary`; public.
- `publication_year`: `year`, `yr`, `publication_year`; public.
- `publication_date`: `date`, `dt`, `publication_date`; public.
- `venue_name`: `venue`, `journal`, `conference`, `source_title`; public.
- `citation_count`: `citations`, `n_cite`, `citation_count`, `cited_by_count`; public.
- `language_code`: `lang`, `language`, `language_code`; public.
- `publication_type`: `type`, `typ`, `publication_type`, `document_type`; public.
- `retraction_flag`: `retracted`, `is_retracted`, `withdrawn`; public.
- `author_id`: `author_id`, `aid`, `researcher_id`; public/PII.
- `author_name`: `author`, `author_name`, `researcher_name`; PII/public.
- `institution_name`: `institution`, `affiliation`, `university`; public.
- `concept_topic`: `topic`, `field`, `concept`, `keyword`; public.

Report templates:

- Publications and citations by year.
- Venue impact summary.
- Retraction / quality watch.
- Author or institution contribution.
- Topic trend report.

### Government operations and civic services

- `case_id`: `case_id`, `application_id`, `service_request_id`; PII/public depending domain.
- `agency_name`: `agency`, `department`, `office`; public.
- `program_name`: `program`, `scheme`, `benefit_program`; public/financial.
- `beneficiary_id`: `beneficiary_id`, `recipient_id`, `applicant_id`; PII/secret.
- `application_status`: `application_status`, `case_status`, `status`; public/PII.
- `submission_date`: `submission_date`, `filed_at`, `application_date`; public/PII.
- `decision_date`: `decision_date`, `approved_at`, `rejected_at`; public/PII.
- `processing_days`: `processing_days`, `turnaround_days`, `tat_days`; public/operational.
- `benefit_amount`: `benefit_amount`, `grant_amount`, `disbursement`; financial/PII.
- `service_category`: `service`, `request_type`, `complaint_type`; public.

Report templates:

- Service request volume and SLA.
- Program disbursement by geography.
- Application funnel / backlog.

## Template/report expansion backlog

For every new domain, add at least one deterministic report template. A template should declare:

- Required semantic roles.
- Optional semantic roles.
- Default SQL.
- Recommended chart types.
- Suggested KPI tiles.
- Default report-cell layout.
- Sensitivity caveats.

Priority templates:

1. Generic dataset profile: row count, column count, missingness, top categories, numeric distributions.
2. Amount over time: date + amount + category/entity.
3. Geography cut: geo field + amount/count/price.
4. Marketplace supply: listing ID + geography + listing type + price + availability.
5. Outcome comparison: outcome flag + demographic/category + numeric controls.
6. Retail performance: sales/profit/quantity + category + region + date.
7. Marketing funnel: impressions/clicks/spend/conversions + campaign/channel/date.
8. SaaS retention/revenue: account/user + date + plan + MRR/churn/usage.
9. Risk queue: entity/transaction + score/flag + amount/date.
10. Data quality brief: missingness, duplicate IDs, outliers, type anomalies.

## Changes beyond taxonomy

### 1. Report Builder from results

Add a "Create report from result" action next to "Suggest chart" and "X-Ray".

Behavior:

- Creates a report cell populated with the source SQL result.
- Adds default title, subtitle, timestamp, row count, and query provenance.
- Adds KPI tiles from numeric columns.
- Embeds the result table with a display cap and footnote.
- If categorical + numeric columns exist, adds a chart suggestion.
- Includes a "Key notes" markdown area the analyst can edit.

Why: today's report cell is printable but blank. Analysts need a bridge from successful SQL to staff-facing artifact.

### 2. Executive report templates

Add report-cell templates:

- "Briefing memo": headline, 3 KPI tiles, chart, table, notes.
- "Operating review": KPI band, trend section, breakdown section, risks/actions.
- "Dataset audit": coverage, missingness, duplicates, outliers.
- "Board appendix": dense tables with provenance and export timestamp.

### 3. Result snapshot persistence

Persist small result snapshots in IDB/workbook state:

- Store table schema, first N rows, row count, run timestamp, query hash.
- Mark stale when source fingerprints change or SQL changes.
- Keep full recomputation local and user-initiated.

Why: reload currently restores cells and sources but shows "Run to see results." For senior-staff prep, drafts should reopen with visible evidence and staleness labels.

### 4. One-click report refresh

Add a report-level "Refresh report" button:

- Re-run upstream SQL/chart/stat cells in lineage order.
- Update result snapshots and report embeds.
- Surface failures inline with cell provenance.

### 5. Broader suggested reports

Suggested reports should not require only finance-shaped data.

Add a two-level suggestion strategy:

- Domain templates when specific semantic shapes are found.
- Generic templates when only broad roles are found: category, date, amount/metric, geography, ID, outcome.

Example: Airbnb with `neighbourhood_group`, `room_type`, `price`, `availability_365`, `number_of_reviews` should trigger "Marketplace supply and price brief."

### 6. Analyst-friendly chart materialization

"Suggest chart" currently depends on sidecar. Add deterministic chart shortcuts:

- If category + numeric metric: bar chart.
- If date + numeric metric: line/area chart.
- If latitude + longitude: map.
- If category + category + numeric/count: heatmap or grouped bar.
- If numeric metric only: distribution.

These can run without BYOK and without prose narration.

### 7. Column role override improvements

Schema override should let analysts map generic roles quickly:

- Mark as geography/category/metric/date/ID/outcome.
- Mark as sensitive/PII/financial/secret.
- Save override rules by header pattern.
- Use overrides immediately to unlock report suggestions.

### 8. Hosted R/WebR verification

The live response headers include:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

But the in-app browser context reported:

- `crossOriginIsolated=false`
- `SharedArrayBuffer` unavailable

Action:

- Verify in a normal Chrome/Edge tab on `naklidata.naklitechie.com`.
- Add a hosted smoke check for `crossOriginIsolated` and R-cell initialization.
- If normal Chrome passes, document that embedded/browser-plugin contexts may not expose SAB.
- If normal Chrome fails, inspect service worker, iframe embedding, redirect, or asset headers.

### 9. Public URL mount ergonomics

Observed flow works, but after sources exist the path is less obvious than first-run.

Improvements:

- Make the add-source menu modal visually distinct and keyboard-friendly.
- Keep "Paste URL" discoverable in the Sources header.
- Show URL host, file size if known, and CORS/readability status after mount.

### 10. Dataset provenance block

For remote URL sources, capture and display:

- Source URL.
- Host.
- Mounted at timestamp.
- Content length / ETag / Last-Modified when available.
- File format and inferred table name.

Then report cells can include provenance footnotes automatically.

### 11. Senior-staff export mode

Improve "Export HTML" / print output for leadership packets:

- Hide editor chrome by default.
- Include report title, timestamp, source provenance, and staleness state.
- Render tables with page-safe widths.
- Include "Prepared in NakliData; data processed locally" footer.

### 12. Report recommendation sidecar guardrails

When BYOK sidecar is enabled, report recommendations should output strict JSON only:

- Template ID.
- Reason codes tied to recognized semantic roles.
- SQL cell IDs / source table IDs.
- Proposed chart configs.
- Proposed KPI configs.

No prose-only recommendations; parser rejects unknown fields and unknown columns.

## Implementation order

1. Add taxonomy domains for marketplace/listings, geography, retail/orders, and outcome/demographic sample datasets.
2. Add generic report-template fallback rules based on broad roles.
3. Add deterministic "Create report from result."
4. Add deterministic chart shortcuts that do not require sidecar.
5. Add result snapshot persistence with stale labels.
6. Add hosted R/WebR isolation smoke.
7. Expand remaining taxonomy domains in batches: marketing/SaaS, real estate, HR, healthcare, education, public sector, scientific.

## Suggested immediate slice

Small, high-value first PR:

- Add taxonomy types:
  - `latitude`, `longitude`, `district_neighbourhood`, `state_region`
  - `listing_id`, `listing_name`, `host_id`, `host_name`, `room_type`, `availability_days`, `minimum_stay`, `review_count`, `reviews_per_period`, `last_review_date`
  - `survival_flag`, `passenger_class`, `sex_gender`, `age_years`, `fare_amount`, `embarkation_port`
- Add templates:
  - "Marketplace supply and price brief"
  - "Outcome comparison brief"
  - "Generic dataset quality brief"
- Add tests using Titanic and AB_NYC_2019 fixtures or generated mini-fixtures with matching headers.

This should directly address the real-data gaps observed in the browser test without changing the core engine.
