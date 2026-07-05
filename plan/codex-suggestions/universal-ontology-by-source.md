# Universal ontology by source

Date: 2026-07-05

Purpose: a broad reference inventory for later cross-report connections. This document is intentionally source-shaped and more universal than the product-actionable NakliData taxonomy backlog in `real-data-reporting-improvements.md`.

This is not a direct implementation plan. It is a reference map of source vocabularies and the terms/roles NakliData may eventually map into its own compact report-role taxonomy.

## How to read this

For each source:

- **Use for:** what the source is good at.
- **Core objects / role families:** the high-level ontology shape.
- **Candidate NakliData roles:** field roles worth mapping.
- **Cross-report connection value:** why this helps connect reports across domains.

## 1. NakliData compiled taxonomy backlog

Source file:

- `plan/codex-suggestions/real-data-reporting-improvements.md`

Use for:

- Product-shaped report roles.
- Analyst workflows.
- Suggested reports and chart defaults.
- Practical column aliases seen in CSV/XLSX/JSONL/Parquet files.

Core objects / role families:

- Cross-domain identifiers.
- Geography and location.
- Marketplace/listings.
- Hospitality/travel.
- Passenger/outcome sample datasets.
- Retail/orders.
- Marketing/growth.
- Product analytics/SaaS.
- Healthcare.
- Education.
- HR/people operations.
- Real estate.
- Risk/fraud/security.
- Public sector/demographics.
- Scientific measurements.
- Supply chain/procurement/inventory.
- Banking/payments/lending.
- Insurance.
- Energy/utilities/infrastructure.
- Manufacturing/quality.
- Customer support/success.
- Legal/contracts/compliance.
- Media/content/publishing.
- Agriculture/food systems.
- Sports/events.
- Nonprofit/fundraising.
- Research/scholarly/knowledge graphs.
- Government operations/civic services.

Candidate NakliData roles:

- Already enumerated in the source file.

Cross-report connection value:

- This is the "report-facing" ontology. It should remain smaller and more opinionated than the universal reference.

## 2. Schema.org

Source:

- `https://schema.org/docs/schemas.html`
- `https://schema.org/Dataset`
- `https://schema.org/Product`

Use for:

- General web/entity semantics.
- Cross-domain entities that appear in public datasets.
- Mapping people, organizations, places, products, events, reviews, jobs, media, and datasets.

Core objects / role families:

- `Thing`
- `Person`
- `Organization`
- `Place`
- `PostalAddress`
- `GeoCoordinates`
- `Product`
- `Offer`
- `AggregateOffer`
- `Service`
- `Event`
- `CreativeWork`
- `Dataset`
- `DataCatalog`
- `Review`
- `Rating`
- `JobPosting`
- `Action`
- `ContactPoint`
- `Brand`
- `PropertyValue`

Candidate NakliData roles:

- `schema_person_id`
- `person_name`
- `given_name`
- `family_name`
- `birth_date`
- `gender`
- `organization_id`
- `organization_name`
- `legal_name`
- `brand_name`
- `contact_point`
- `email`
- `telephone`
- `address_line`
- `street_address`
- `city`
- `state_region`
- `postal_code`
- `country_name`
- `latitude`
- `longitude`
- `place_name`
- `product_id`
- `sku`
- `gtin`
- `mpn`
- `product_name`
- `product_category`
- `brand_name`
- `offer_id`
- `price`
- `price_currency`
- `availability_status`
- `valid_from`
- `valid_through`
- `event_id`
- `event_name`
- `event_start_date`
- `event_end_date`
- `venue_name`
- `creative_work_id`
- `title`
- `description`
- `author_name`
- `publisher_name`
- `date_published`
- `date_modified`
- `review_id`
- `review_rating`
- `rating_value`
- `best_rating`
- `worst_rating`
- `job_title`
- `employment_type`
- `base_salary`
- `dataset_id`
- `dataset_name`
- `dataset_description`
- `dataset_license`
- `dataset_distribution`

Cross-report connection value:

- Common bridge for public datasets that describe entities in everyday language.
- Useful for linking commerce, content, HR, events, geography, and dataset provenance.

## 3. Dublin Core Metadata Terms

Source:

- `https://www.dublincore.org/documents/dcmi-terms/`

Use for:

- Resource metadata.
- Dataset/report provenance.
- Report footnotes and cross-report cataloging.

Core objects / role families:

- Resource description.
- Intellectual property metadata.
- Lifecycle metadata.
- Coverage metadata.
- Relation metadata.

Candidate NakliData roles:

- `dc_title`
- `dc_description`
- `dc_creator`
- `dc_contributor`
- `dc_publisher`
- `dc_date`
- `dc_created`
- `dc_modified`
- `dc_issued`
- `dc_identifier`
- `dc_source`
- `dc_relation`
- `dc_replaces`
- `dc_is_replaced_by`
- `dc_license`
- `dc_rights`
- `dc_rights_holder`
- `dc_language`
- `dc_format`
- `dc_type`
- `dc_subject`
- `dc_coverage`
- `dc_spatial`
- `dc_temporal`
- `dc_audience`
- `dc_provenance`

Cross-report connection value:

- Lets generated reports carry stable provenance and rights metadata.
- Helps connect reports that summarize the same source, publisher, subject, license, or temporal/spatial coverage.

## 4. DCAT / DCAT-US

Sources:

- `https://www.w3.org/TR/vocab-dcat-3/`
- `https://resources.data.gov/resources/dcat-us3/`

Use for:

- Dataset catalog metadata.
- Remote source provenance.
- Dataset/distribution/service relationships.

Core objects / role families:

- `Catalog`
- `Dataset`
- `DatasetSeries`
- `Distribution`
- `DataService`
- `Resource`
- `CatalogRecord`

Candidate NakliData roles:

- `catalog_id`
- `catalog_title`
- `dataset_id`
- `dataset_title`
- `dataset_description`
- `dataset_keyword`
- `dataset_theme`
- `dataset_contact_point`
- `dataset_publisher`
- `dataset_spatial`
- `dataset_temporal`
- `dataset_accrual_periodicity`
- `dataset_landing_page`
- `distribution_id`
- `distribution_title`
- `distribution_access_url`
- `distribution_download_url`
- `distribution_media_type`
- `distribution_format`
- `distribution_byte_size`
- `distribution_checksum`
- `distribution_modified`
- `data_service_endpoint_url`
- `data_service_endpoint_description`

Cross-report connection value:

- Connects reports by source dataset/distribution, access URL, publisher, theme, and refresh metadata.
- Provides the right backbone for source provenance blocks.

## 5. Frictionless Table Schema / Data Package

Source:

- `https://frictionlessdata.io/specs/table-schema/`

Use for:

- Structural field metadata.
- Type/format/constraint validation.
- Export manifests.

Core objects / role families:

- Package.
- Resource.
- Schema.
- Field.
- Type.
- Format.
- Constraint.
- Missing values.
- Primary key.
- Foreign key.

Candidate NakliData roles:

- `field_name`
- `field_title`
- `field_description`
- `field_type`
- `field_format`
- `field_missing_values`
- `field_constraints_required`
- `field_constraints_unique`
- `field_constraints_minimum`
- `field_constraints_maximum`
- `field_constraints_min_length`
- `field_constraints_max_length`
- `field_constraints_pattern`
- `primary_key`
- `foreign_key_fields`
- `foreign_key_reference_resource`
- `foreign_key_reference_fields`
- `resource_name`
- `resource_path`
- `resource_format`
- `resource_encoding`
- `resource_schema`

Cross-report connection value:

- Useful for data-quality consistency and for recognizing compatible columns across unrelated files.

## 6. OpenMetadata governance

Sources:

- `https://openmetadatastandards.org/governance/overview/`
- `https://docs.open-metadata.org/v1.12.x/how-to-guides/data-governance/glossary`
- `https://docs.open-metadata.org/v1.12.x/how-to-guides/data-governance/classification/auto-classification`

Use for:

- Separating glossary terms from classification tags.
- Governance status and sensitivity.
- Data-asset metadata patterns.

Core objects / role families:

- Glossary.
- Glossary term.
- Classification.
- Tag.
- Data asset.
- Domain.
- Owner.
- Tier.
- PII/non-PII.
- Sensitivity.

Candidate NakliData roles:

- `business_term`
- `business_definition`
- `term_synonym`
- `term_owner`
- `classification_tag`
- `pii_tag`
- `sensitivity_tag`
- `data_tier`
- `domain_name`
- `asset_owner`
- `steward`
- `certification_status`
- `deprecation_status`
- `usage_context`

Cross-report connection value:

- Helps report connections respect business vocabulary, not just physical column names.

## 7. Microsoft Purview Sensitive Information Types

Source:

- `https://learn.microsoft.com/en-us/purview/sit-sensitive-information-type-entity-definitions`

Use for:

- Sensitive-data detector coverage.
- Country/region specific identifiers.
- Confidence levels and pattern-based classification.

Core objects / role families:

- Government IDs.
- Tax IDs.
- Bank accounts.
- Credit/debit cards.
- Health identifiers.
- Credentials/secrets.
- Contact information.
- Location/address.
- Financial identifiers.

Candidate NakliData roles:

- `credit_card_number`
- `iban`
- `swift_bic`
- `bank_account_number`
- `routing_number`
- `passport_number`
- `driver_license_number`
- `national_id_number`
- `social_security_number`
- `tax_identification_number`
- `health_insurance_number`
- `medical_record_number`
- `date_of_birth`
- `phone_number`
- `email_address`
- `physical_address`
- `ip_address`
- `credential_secret`
- `api_key`
- `private_key`
- `password`
- `token`

Cross-report connection value:

- Prevents unsafe cross-report joins on sensitive identifiers unless explicitly allowed.
- Enables anonymized export strategy defaults.

## 8. Google Sensitive Data Protection infoTypes

Source:

- `https://docs.cloud.google.com/sensitive-data-protection/docs/infotypes-reference`

Use for:

- Broad built-in detector list.
- Global and regional PII/financial/credential coverage.
- Detector grouping and custom infoType pattern.

Core objects / role families:

- Person names.
- Contact data.
- Government IDs.
- Financial data.
- Credentials.
- Network identifiers.
- Medical data.
- Dates and demographic data.
- Country-specific identifiers.

Candidate NakliData roles:

- Same role family as Purview, plus:
- `mac_address`
- `imei`
- `vehicle_identification_number`
- `crypto_wallet_address`
- `auth_token`
- `oauth_client_secret`
- `database_connection_string`
- `encryption_key`
- `cloud_provider_credential`
- `precise_location`

Cross-report connection value:

- Complements Purview for credentials/secrets and cloud-data use cases.

## 9. Microsoft Presidio supported entities

Source:

- `https://data-privacy-stack.github.io/presidio/supported_entities/`

Use for:

- Lightweight local/open-source PII recognizers.
- Text-field scanning for unstructured columns.

Core objects / role families:

- Person.
- Location.
- Organization.
- Date/time.
- Phone.
- Email.
- URL.
- IP.
- Credit card.
- Crypto.
- National IDs.
- Medical/license identifiers, depending recognizers.

Candidate NakliData roles:

- `person_name`
- `location_name`
- `organization_name`
- `date_time`
- `email_address`
- `phone_number`
- `url`
- `ip_address`
- `credit_card_number`
- `crypto_wallet_address`
- `national_id_number`
- `medical_license`

Cross-report connection value:

- Useful for scanning free-text columns before sidecar prompts or exports.

## 10. dbt Semantic Layer / MetricFlow

Sources:

- `https://docs.getdbt.com/docs/build/semantic-models`
- `https://docs.getdbt.com/docs/build/dimensions`

Use for:

- Semantic modeling primitives.
- Metric/report eligibility.
- Consistent measures across reports.

Core objects / role families:

- Semantic model.
- Entity.
- Dimension.
- Time dimension.
- Measure.
- Metric.
- Simple metric.
- Ratio metric.
- Cumulative metric.
- Derived metric.

Candidate NakliData roles:

- `semantic_entity`
- `primary_entity`
- `foreign_entity`
- `categorical_dimension`
- `time_dimension`
- `measure_sum`
- `measure_count`
- `measure_count_distinct`
- `measure_average`
- `metric_simple`
- `metric_ratio`
- `metric_cumulative`
- `metric_derived`
- `grain`
- `aggregation_time_dimension`

Cross-report connection value:

- This is the best model for connecting reports around shared measures and dimensions.
- Helps avoid multiple reports defining "revenue" or "active user" differently.

## 11. Great Expectations

Source:

- `https://greatexpectations.io/expectations/`

Use for:

- Data-quality checks.
- Assertions generated from semantic roles.

Core objects / role families:

- Table expectations.
- Column expectations.
- Column-pair expectations.
- Multi-column expectations.
- Type expectations.
- Set/range/pattern expectations.
- Nullability and uniqueness expectations.

Candidate NakliData roles:

- `expect_table_row_count`
- `expect_table_columns_match`
- `expect_column_exists`
- `expect_column_values_to_not_be_null`
- `expect_column_values_to_be_unique`
- `expect_column_values_to_be_of_type`
- `expect_column_values_to_be_in_set`
- `expect_column_values_to_match_regex`
- `expect_column_values_to_be_between`
- `expect_column_pair_values_to_be_equal`
- `expect_compound_columns_to_be_unique`
- `expect_column_distinct_values_to_be_in_set`
- `expect_column_most_common_value`

Cross-report connection value:

- Lets reports carry data-quality confidence and comparable validation outcomes.

## 12. OpenLineage

Sources:

- `https://openlineage.io/docs/spec/facets/dataset-facets/column_lineage_facet/`
- `https://openlineage.io/docs/spec/facets/dataset-facets/data_quality_assertions/`

Use for:

- Source-to-result lineage.
- Dataset stats.
- Quality facets.
- Refresh impact.

Core objects / role families:

- Job.
- Run.
- Dataset.
- Input dataset.
- Output dataset.
- Schema facet.
- Column lineage facet.
- Data quality assertions.
- Data quality metrics.
- Input statistics.

Candidate NakliData roles:

- `lineage_input_dataset`
- `lineage_output_dataset`
- `lineage_input_column`
- `lineage_output_column`
- `lineage_transformation_type`
- `dataset_row_count`
- `dataset_byte_size`
- `column_null_count`
- `column_distinct_count`
- `column_min`
- `column_max`
- `column_quantile`
- `quality_assertion_name`
- `quality_assertion_column`
- `quality_assertion_result`
- `quality_assertion_observed_value`

Cross-report connection value:

- Critical for "where did this number come from?" across reports.

## 13. FHIR / HL7 healthcare

Sources:

- `https://www.hl7.org/fhir/resourcelist.html`
- `https://build.fhir.org/encounter.html`
- `https://build.fhir.org/claim.html`

Use for:

- Healthcare and claims data.
- Clinical events, observations, encounters, procedures.

Core objects / role families:

- Patient.
- Practitioner.
- Organization.
- Location.
- Encounter.
- Observation.
- Condition.
- Procedure.
- Medication.
- MedicationRequest.
- DiagnosticReport.
- Claim.
- Coverage.
- ExplanationOfBenefit.
- Appointment.
- CarePlan.

Candidate NakliData roles:

- `patient_id`
- `patient_name`
- `birth_date`
- `sex_gender`
- `encounter_id`
- `encounter_class`
- `encounter_status`
- `encounter_start`
- `encounter_end`
- `practitioner_id`
- `facility_id`
- `condition_code`
- `condition_onset_date`
- `procedure_code`
- `procedure_date`
- `observation_code`
- `observation_value`
- `observation_unit`
- `observation_effective_time`
- `medication_code`
- `medication_name`
- `claim_id`
- `claim_line_id`
- `claim_amount`
- `coverage_id`
- `payer`
- `diagnosis_code`

Cross-report connection value:

- Healthcare reports usually connect through patient/encounter/claim/observation; FHIR provides the deep bridge.

## 14. ISO 20022

Sources:

- `https://www.iso20022.org/iso-20022-message-definitions`
- `https://www.swift.com/standards/iso-20022/iso-20022-standards`

Use for:

- Banking, payments, cash management, securities, reference data.

Core objects / role families:

- Payment initiation.
- Customer credit transfer.
- Debtor.
- Creditor.
- Account.
- Agent/bank.
- Remittance information.
- Cash management statement.
- Balance.
- Entry.
- Transaction.
- Mandate.
- Securities settlement.
- Reference data.

Candidate NakliData roles:

- `payment_message_id`
- `instruction_id`
- `end_to_end_id`
- `transaction_id`
- `debtor_id`
- `debtor_name`
- `debtor_account`
- `debtor_agent`
- `creditor_id`
- `creditor_name`
- `creditor_account`
- `creditor_agent`
- `payment_amount`
- `currency_iso`
- `settlement_date`
- `execution_date`
- `remittance_information`
- `charge_bearer`
- `bank_transaction_code`
- `account_balance`
- `statement_id`
- `entry_reference`
- `mandate_id`

Cross-report connection value:

- Deep connection for payment lifecycle reports, bank statements, reconciliation, and counterparty analysis.

## 15. Open Contracting Data Standard (OCDS)

Sources:

- `https://standard.open-contracting.org/latest/en/schema/reference/`
- `https://www.open-contracting.org/data-standard/`

Use for:

- Procurement, contracts, tenders, awards, public spending.

Core objects / role families:

- Release.
- Record.
- Planning.
- Tender.
- Buyer.
- Procuring entity.
- Item.
- Award.
- Supplier.
- Contract.
- Implementation.
- Transaction.
- Milestone.
- Document.
- Party.
- Value.

Candidate NakliData roles:

- `ocid`
- `release_id`
- `release_date`
- `tender_id`
- `tender_title`
- `tender_status`
- `procurement_method`
- `buyer_id`
- `buyer_name`
- `procuring_entity_id`
- `award_id`
- `award_status`
- `award_date`
- `supplier_id`
- `supplier_name`
- `contract_id`
- `contract_status`
- `contract_start_date`
- `contract_end_date`
- `contract_value`
- `currency_iso`
- `item_id`
- `item_description`
- `milestone_id`
- `milestone_due_date`
- `milestone_status`
- `transaction_id`
- `transaction_amount`
- `document_type`
- `document_url`

Cross-report connection value:

- Strong bridge between supplier spend, public-sector performance, contract lifecycle, and payment reports.

## 16. Darwin Core

Sources:

- `https://dwc.tdwg.org/terms/`
- `https://dwc.tdwg.org/list/`

Use for:

- Biodiversity, specimens, observations, ecological field data.

Core objects / role families:

- Occurrence.
- Organism.
- Material entity.
- Event.
- Location.
- Geological context.
- Identification.
- Taxon.
- Measurement or fact.
- Resource relationship.

Candidate NakliData roles:

- `occurrence_id`
- `basis_of_record`
- `catalog_number`
- `recorded_by`
- `individual_count`
- `organism_id`
- `event_id`
- `event_date`
- `sampling_protocol`
- `sample_size_value`
- `sample_size_unit`
- `location_id`
- `decimal_latitude`
- `decimal_longitude`
- `coordinate_uncertainty`
- `country`
- `state_province`
- `county`
- `locality`
- `minimum_elevation`
- `maximum_elevation`
- `scientific_name`
- `taxon_id`
- `taxon_rank`
- `kingdom`
- `phylum`
- `class`
- `order`
- `family`
- `genus`
- `specific_epithet`
- `identified_by`
- `date_identified`
- `measurement_type`
- `measurement_value`
- `measurement_unit`

Cross-report connection value:

- Connects ecological reports through taxon/location/event/measurement axes.

## 17. GoodRelations

Sources:

- `https://www.heppnetz.de/ontologies/goodrelations/v1.html`
- `https://www.w3.org/wiki/GoodRelations`

Use for:

- Ecommerce, product/offering/price/business metadata.

Core objects / role families:

- BusinessEntity.
- Offering.
- ProductOrService.
- PriceSpecification.
- PaymentMethod.
- DeliveryMethod.
- WarrantyPromise.
- OpeningHoursSpecification.
- BusinessFunction.
- QuantitativeValue.

Candidate NakliData roles:

- `business_entity_id`
- `business_entity_name`
- `offering_id`
- `offer_name`
- `business_function`
- `product_or_service_id`
- `product_or_service_name`
- `price_specification_id`
- `price`
- `currency_iso`
- `eligible_quantity`
- `eligible_region`
- `valid_from`
- `valid_through`
- `payment_method`
- `delivery_method`
- `warranty_scope`
- `opening_hours`
- `store_location`

Cross-report connection value:

- Bridges retail, marketplace, pricing, inventory, and promotion reports.

## 18. Open Referral HSDS

Sources:

- `https://docs.openreferral.org/en/latest/hsds/schema_reference.html`
- `https://docs.openreferral.org/en/latest/hsds/overview.html`

Use for:

- Human, health, and social-service directory data.
- Community resource discovery datasets.

Core objects / role families:

- Organization.
- Program.
- Service.
- Location.
- Address.
- Contact.
- Phone.
- Schedule.
- Eligibility.
- Taxonomy.
- Taxonomy term.
- Service area.
- Required document.
- Funding.
- Accessibility.

Candidate NakliData roles:

- `organization_id`
- `organization_name`
- `program_id`
- `program_name`
- `service_id`
- `service_name`
- `service_description`
- `service_status`
- `service_url`
- `location_id`
- `location_name`
- `address_line`
- `city`
- `state_region`
- `postal_code`
- `latitude`
- `longitude`
- `contact_name`
- `phone_number`
- `email_address`
- `regular_schedule`
- `opens_at`
- `closes_at`
- `eligibility`
- `taxonomy_id`
- `taxonomy_term`
- `service_area`
- `required_document`
- `funding_source`
- `accessibility_feature`

Cross-report connection value:

- Connects government/civic, nonprofit, healthcare access, and location-service reports.

## 19. OpenAPI / JSON Schema

Sources to consider later:

- `https://spec.openapis.org/oas/latest.html`
- `https://json-schema.org/`

Use for:

- API-provided datasets.
- Type/format constraints.
- Parameter and response schemas.

Core objects / role families:

- Schema object.
- Property.
- Type.
- Format.
- Enum.
- Required.
- Nullable.
- Minimum/maximum.
- Pattern.
- Reference.
- Path.
- Operation.
- Parameter.
- Request body.
- Response.

Candidate NakliData roles:

- `api_path`
- `api_operation_id`
- `api_parameter`
- `api_response_field`
- `json_schema_type`
- `json_schema_format`
- `json_schema_enum`
- `json_schema_required`
- `json_schema_pattern`
- `json_schema_ref`

Cross-report connection value:

- Useful if NakliData later mounts API/catalog sources and wants to preserve upstream schema semantics.

## 20. OpenStreetMap tags

Source to consider later:

- `https://wiki.openstreetmap.org/wiki/Map_features`

Use for:

- Place/POI/geospatial datasets.
- Business/location reports.

Core objects / role families:

- Amenity.
- Shop.
- Tourism.
- Office.
- Building.
- Highway.
- Railway.
- Public transport.
- Landuse.
- Natural.
- Boundary.
- Address.
- Opening hours.

Candidate NakliData roles:

- `osm_id`
- `osm_type`
- `amenity_type`
- `shop_type`
- `tourism_type`
- `office_type`
- `building_type`
- `highway_type`
- `landuse_type`
- `boundary_type`
- `addr_housenumber`
- `addr_street`
- `addr_city`
- `opening_hours`
- `operator_name`

Cross-report connection value:

- Bridges maps, retail locations, civic services, infrastructure, and mobility reports.

## 21. GTFS transit data

Source to consider later:

- `https://gtfs.org/schedule/reference/`

Use for:

- Transit schedules and mobility datasets.

Core objects / role families:

- Agency.
- Route.
- Trip.
- Stop.
- Stop time.
- Calendar.
- Fare.
- Shape.
- Frequency.
- Transfer.

Candidate NakliData roles:

- `agency_id`
- `agency_name`
- `route_id`
- `route_short_name`
- `route_long_name`
- `route_type`
- `trip_id`
- `service_id`
- `stop_id`
- `stop_name`
- `stop_latitude`
- `stop_longitude`
- `arrival_time`
- `departure_time`
- `stop_sequence`
- `fare_id`
- `shape_id`
- `transfer_type`

Cross-report connection value:

- Connects transport service coverage, geography, schedules, reliability, and public-sector reports.

## 22. XBRL / accounting taxonomy

Sources to consider later:

- `https://www.xbrl.org/`
- Local jurisdiction taxonomies such as US GAAP, IFRS, MCA India when needed.

Use for:

- Financial statements.
- Regulatory filings.
- Accounting concepts.

Core objects / role families:

- Entity.
- Period.
- Unit.
- Concept.
- Fact.
- Context.
- Balance sheet.
- Income statement.
- Cash flow.
- Equity.
- Notes/disclosures.

Candidate NakliData roles:

- `reporting_entity`
- `fiscal_period`
- `fiscal_year`
- `currency_iso`
- `accounting_concept`
- `financial_fact_value`
- `assets`
- `liabilities`
- `equity`
- `revenue`
- `expenses`
- `net_income`
- `cash_flow_operating`
- `cash_flow_investing`
- `cash_flow_financing`
- `earnings_per_share`

Cross-report connection value:

- Connects internal finance reports with public filings and accounting definitions.

## 23. SDMX / statistical data

Source to consider later:

- `https://sdmx.org/`

Use for:

- Official statistics.
- Time series.
- Multi-dimensional statistical cubes.

Core objects / role families:

- Dataflow.
- Dataset.
- Data structure definition.
- Dimension.
- Attribute.
- Measure.
- Code list.
- Observation.
- Time period.
- Frequency.

Candidate NakliData roles:

- `stat_dimension`
- `stat_measure`
- `stat_attribute`
- `stat_codelist`
- `observation_value`
- `observation_status`
- `time_period`
- `frequency`
- `unit_measure`
- `geo_area`
- `indicator`

Cross-report connection value:

- Connects public statistics, demographics, economics, and time-series reports.

## 24. W3C PROV

Source to consider later:

- `https://www.w3.org/TR/prov-o/`

Use for:

- Provenance beyond dataset metadata.
- Agent/activity/entity relationships.

Core objects / role families:

- Entity.
- Activity.
- Agent.
- Generation.
- Usage.
- Derivation.
- Attribution.
- Association.
- Delegation.
- Invalidation.

Candidate NakliData roles:

- `prov_entity`
- `prov_activity`
- `prov_agent`
- `generated_at_time`
- `used_entity`
- `was_derived_from`
- `was_attributed_to`
- `was_associated_with`
- `acted_on_behalf_of`

Cross-report connection value:

- Provides a general graph for how reports, sources, transformations, and analysts relate.

## 25. SKOS (Simple Knowledge Organization System)

Source(s):
- W3C SKOS Reference: `https://www.w3.org/TR/skos-reference/`

Use for:
- Taxonomy, thesaurus, code-list, and classification-system modeling.
- Mapping between labels, synonyms, broader/narrower concepts, and related concepts.

Core objects / role families:
- Concept.
- Concept scheme.
- Preferred label.
- Alternate label.
- Hidden label.
- Broader concept.
- Narrower concept.
- Related concept.
- Exact match.
- Close match.
- Broad match.
- Narrow match.

Candidate NakliData roles:
- `concept_id`
- `concept_label`
- `concept_scheme`
- `preferred_label`
- `alternate_label`
- `synonym`
- `parent_concept`
- `child_concept`
- `related_concept`
- `taxonomy_mapping`
- `classification_code`
- `classification_name`

Cross-report connection value:
- This is a strong meta-layer for NakliData's own taxonomy. It gives us a way to keep broad internal role names, external source-specific codes, and analyst-friendly labels connected without pretending every source has the same vocabulary.

## 26. FOAF

Source(s):
- FOAF Vocabulary Specification: `https://xmlns.com/foaf/spec/`

Use for:
- People, organizations, groups, online accounts, interests, and person-to-person or person-to-organization relationships.

Core objects / role families:
- Person.
- Agent.
- Organization.
- Group.
- Name.
- Given name.
- Family name.
- Nickname.
- Homepage.
- Workplace homepage.
- School homepage.
- Account.
- Interest.
- Knows relationship.
- Image / depiction.

Candidate NakliData roles:
- `person_id`
- `person_name`
- `given_name`
- `family_name`
- `nickname`
- `agent_id`
- `organization_id`
- `organization_name`
- `group_id`
- `account_id`
- `account_name`
- `homepage_url`
- `profile_url`
- `workplace_url`
- `school_url`
- `interest`
- `relationship_knows`
- `image_url`

Cross-report connection value:
- Helpful for connecting CRM, HR, education, social, creator, support, and organizational reports around people and agents without forcing every person-like field into customer/vendor/employee buckets too early.

## 27. W3C ORG and Registered Organization

Source(s):
- W3C Organization Ontology: `https://www.w3.org/TR/vocab-org/`
- W3C Registered Organization Vocabulary: `https://www.w3.org/TR/vocab-regorg/`

Use for:
- Organizational structures, sub-units, formal posts, memberships, reporting lines, sites, and legal registration identifiers.

Core objects / role families:
- Organization.
- Organizational unit.
- Formal organization.
- Organizational site.
- Post.
- Role.
- Membership.
- Reporting relationship.
- Classification.
- Registered organization.
- Legal entity identifier.
- Registered address.
- Jurisdiction.

Candidate NakliData roles:
- `organization_id`
- `organization_name`
- `organization_unit`
- `parent_organization`
- `subsidiary_organization`
- `department`
- `team`
- `site_id`
- `site_name`
- `site_address`
- `post_id`
- `job_post`
- `role_name`
- `membership_id`
- `member_id`
- `reports_to`
- `legal_entity_id`
- `registration_number`
- `registration_authority`
- `jurisdiction`
- `registered_address`

Cross-report connection value:
- Gives NakliData a clean bridge between HR, finance, procurement, vendor, public-company, nonprofit, and legal-entity reports.

## 28. RDF Data Cube and QB4ST

Source(s):
- W3C RDF Data Cube Vocabulary: `https://www.w3.org/TR/vocab-data-cube/`
- W3C QB4ST spatial-temporal extension: `https://www.w3.org/TR/qb4st/`

Use for:
- Multidimensional statistical datasets with observations, dimensions, measures, attributes, slices, and spatial/temporal extensions.

Core objects / role families:
- Dataset.
- Observation.
- Dimension.
- Measure.
- Attribute.
- Slice.
- Data structure definition.
- Code list.
- Time period.
- Spatial unit.
- Statistical unit.

Candidate NakliData roles:
- `dataset_id`
- `observation_id`
- `measure_value`
- `measure_name`
- `dimension_name`
- `dimension_value`
- `attribute_name`
- `attribute_value`
- `slice_id`
- `time_period`
- `reference_period`
- `geographic_unit`
- `statistical_unit`
- `code_list_value`

Cross-report connection value:
- Useful for cross-report dashboards, especially when multiple reports share geography, time, demographic, or product dimensions but use different metric columns.

## 29. W3C SSN/SOSA and OGC SWE Common

Source(s):
- W3C Semantic Sensor Network / SOSA: `https://www.w3.org/TR/vocab-ssn-2023/`
- OGC SWE Common Data Model: `https://docs.ogc.org/is/24-014/24-014.html`

Use for:
- Sensors, observations, sampling, actuations, features of interest, observed properties, procedures, units, and time-series measurement streams.

Core objects / role families:
- Sensor.
- Observation.
- Observable property.
- Feature of interest.
- Result.
- Procedure.
- Sample.
- Sampler.
- Actuator.
- Actuation.
- Deployment.
- Platform.
- Unit of measure.
- Phenomenon time.
- Result time.

Candidate NakliData roles:
- `sensor_id`
- `sensor_name`
- `platform_id`
- `deployment_id`
- `observation_id`
- `observed_property`
- `measurement_value`
- `measurement_unit`
- `measurement_timestamp`
- `phenomenon_time`
- `result_time`
- `feature_of_interest`
- `sample_id`
- `procedure_id`
- `actuator_id`
- `actuation_state`
- `quality_flag`

Cross-report connection value:
- Opens reports from IoT, utilities, environmental monitoring, manufacturing, fleet, building operations, and lab measurements to the same metric/time/location grammar.

## 30. GeoSPARQL and OGC Spatial Vocabularies

Source(s):
- OGC GeoSPARQL 1.1: `https://docs.ogc.org/is/22-047r1/22-047r1.html`

Use for:
- Spatial features, geometries, coordinate reference systems, geometry literals, and spatial relationships.

Core objects / role families:
- Feature.
- Geometry.
- Coordinate reference system.
- Spatial object.
- Bounding box.
- Point.
- Line.
- Polygon.
- Spatial relation.
- Topological relation.

Candidate NakliData roles:
- `feature_id`
- `feature_name`
- `geometry`
- `geometry_type`
- `latitude`
- `longitude`
- `coordinate_reference_system`
- `bounding_box`
- `spatial_relation`
- `contains_feature`
- `within_feature`
- `intersects_feature`
- `adjacent_feature`
- `distance`
- `area`
- `length`

Cross-report connection value:
- Lets reports connect by physical location even when one source uses addresses, another uses polygons, and another uses points or administrative areas.

## 31. CityGML and INSPIRE Spatial Themes

Source(s):
- OGC CityGML 3.0: `https://docs.ogc.org/is/20-010/20-010.html`
- INSPIRE spatial data themes: `https://knowledge-base.inspire.ec.europa.eu/tools/inspire-themes_en`

Use for:
- Urban objects, 3D city models, land use, transport, hydrography, protected sites, administrative units, cadastral parcels, elevation, geology, addresses, and infrastructure themes.

Core objects / role families:
- Building.
- Building part.
- Transportation object.
- Road.
- Railway.
- Bridge.
- Tunnel.
- Water body.
- Land use.
- Vegetation.
- Relief.
- City furniture.
- Address.
- Administrative unit.
- Cadastral parcel.
- Protected site.
- Utility network.
- Elevation.
- Geology.

Candidate NakliData roles:
- `building_id`
- `building_name`
- `building_type`
- `building_part_id`
- `parcel_id`
- `land_use_type`
- `road_id`
- `transport_network_id`
- `bridge_id`
- `tunnel_id`
- `water_body_id`
- `protected_site_id`
- `administrative_unit`
- `elevation`
- `geology_type`
- `vegetation_type`
- `city_object_type`
- `address_id`

Cross-report connection value:
- Valuable for real estate, local government, infrastructure, utilities, climate-risk, insurance, and planning reports where senior staff need rollups by place and asset type.

## 32. IFC, buildingSMART, and bSDD

Source(s):
- buildingSMART Industry Foundation Classes: `https://www.buildingsmart.org/standards/bsi-standards/industry-foundation-classes/`
- buildingSMART Data Dictionary: `https://www.buildingsmart.org/users/services/buildingsmart-data-dictionary/`

Use for:
- Building information modeling, construction objects, spaces, systems, materials, project phases, and standardized built-environment property definitions.

Core objects / role families:
- Project.
- Site.
- Building.
- Storey.
- Space.
- Element.
- Wall.
- Slab.
- Beam.
- Column.
- Door.
- Window.
- System.
- Material.
- Property set.
- Quantity.
- Classification.

Candidate NakliData roles:
- `project_id`
- `site_id`
- `building_id`
- `storey_id`
- `space_id`
- `element_id`
- `element_type`
- `system_id`
- `material`
- `property_set`
- `property_name`
- `property_value`
- `quantity_name`
- `quantity_value`
- `classification_code`
- `classification_name`
- `construction_phase`

Cross-report connection value:
- Lets asset, construction, procurement, facilities, energy, and maintenance reports talk about the same physical objects.

## 33. Brick Schema

Source(s):
- Brick Schema: `https://brickschema.org/`

Use for:
- Buildings, equipment, sensors, points, spaces, systems, and operational relationships in smart buildings.

Core objects / role families:
- Building.
- Space.
- Floor.
- Room.
- Equipment.
- HVAC equipment.
- Electrical equipment.
- Point.
- Sensor.
- Setpoint.
- Command.
- Alarm.
- Meter.
- Feed relationship.
- Location relationship.
- Measurement relationship.

Candidate NakliData roles:
- `building_id`
- `floor_id`
- `room_id`
- `space_id`
- `equipment_id`
- `equipment_type`
- `point_id`
- `point_type`
- `sensor_id`
- `meter_id`
- `setpoint_value`
- `command_value`
- `alarm_state`
- `feeds_equipment`
- `located_in`
- `measures_property`
- `building_system`

Cross-report connection value:
- A practical bridge between time-series sensor data, maintenance records, energy bills, space planning, and equipment inventories.

## 34. IEC Common Information Model for Power Systems

Source(s):
- DNV overview of IEC CIM: `https://www.dnv.com/energy/services/common-information-model-cim/`
- PNNL CIM primer: `https://www.pnnl.gov/main/publications/external/technical_reports/PNNL-34946.pdf`

Use for:
- Electricity grid assets, network topology, generation, transmission, distribution, outages, metering, and operational models.

Core objects / role families:
- Power system resource.
- Conducting equipment.
- Connectivity node.
- Terminal.
- Substation.
- Feeder.
- Line.
- Transformer.
- Breaker.
- Switch.
- Busbar.
- Generator.
- Load.
- Meter.
- Measurement.
- Outage.

Candidate NakliData roles:
- `asset_id`
- `power_system_resource`
- `substation_id`
- `feeder_id`
- `line_id`
- `transformer_id`
- `switch_id`
- `breaker_id`
- `meter_id`
- `connectivity_node`
- `terminal_id`
- `generator_id`
- `load_id`
- `measurement_value`
- `outage_id`
- `outage_start`
- `outage_end`
- `service_territory`

Cross-report connection value:
- Helps connect utility asset registers, outage reports, meter readings, work orders, customer impacts, and capital planning.

## 35. MIMOSA CCOM and OSA-EAI

Source(s):
- MIMOSA Common Conceptual Object Model: `https://www.mimosa.org/mimosa-ccom/`
- MIMOSA OSA-EAI: `https://www.mimosa.org/mimosa-osa-eai/`

Use for:
- Industrial asset lifecycle data, asset registries, condition monitoring, reliability, maintenance, and operations information exchange.

Core objects / role families:
- Asset.
- Asset type.
- Location.
- Functional location.
- Segment.
- Measurement.
- Condition.
- Fault.
- Failure mode.
- Event.
- Work order.
- Maintenance action.
- Inspection.
- Reliability metric.
- Part.
- Supplier.

Candidate NakliData roles:
- `asset_id`
- `asset_type`
- `asset_name`
- `functional_location`
- `physical_location`
- `condition_state`
- `condition_score`
- `failure_mode`
- `fault_code`
- `maintenance_event_id`
- `work_order_id`
- `inspection_id`
- `measurement_id`
- `measurement_value`
- `reliability_metric`
- `part_id`
- `supplier_id`

Cross-report connection value:
- Strong fit for plants, fleets, facilities, and infrastructure where reports combine asset condition, failures, maintenance spend, downtime, and vendor performance.

## 36. ISA-95 and B2MML

Source(s):
- ISA-95 standard overview: `https://www.isa.org/standards-and-publications/isa-standards/isa-95-standard`
- MESA B2MML: `https://mesa.org/topics-resources/b2mml/`

Use for:
- Manufacturing enterprise-control integration, production schedules, material lots, equipment, personnel, operations, and performance.

Core objects / role families:
- Enterprise.
- Site.
- Area.
- Work center.
- Work unit.
- Equipment.
- Personnel.
- Material.
- Material lot.
- Material sublot.
- Product definition.
- Production schedule.
- Production request.
- Production response.
- Operations segment.
- Capability.
- Performance.

Candidate NakliData roles:
- `enterprise_id`
- `site_id`
- `area_id`
- `work_center_id`
- `work_unit_id`
- `equipment_id`
- `personnel_id`
- `material_id`
- `material_lot`
- `batch_id`
- `product_id`
- `production_order`
- `production_schedule`
- `operation_id`
- `operation_segment`
- `capability_metric`
- `production_quantity`
- `scrap_quantity`
- `downtime`

Cross-report connection value:
- Connects manufacturing production reports to procurement, inventory, quality, maintenance, labor, and finance.

## 37. Microsoft Common Data Model

Source(s):
- Microsoft Common Data Model: `https://learn.microsoft.com/en-us/common-data-model/`

Use for:
- Business application entities across sales, service, finance, operations, customer, product, and organization data.

Core objects / role families:
- Account.
- Contact.
- Customer.
- Lead.
- Opportunity.
- Product.
- Order.
- Invoice.
- Payment.
- Case.
- Activity.
- Organization.
- Worker.
- Address.
- Currency.
- Transaction.

Candidate NakliData roles:
- `account_id`
- `account_name`
- `contact_id`
- `customer_id`
- `lead_id`
- `opportunity_id`
- `product_id`
- `order_id`
- `invoice_id`
- `payment_id`
- `case_id`
- `activity_id`
- `worker_id`
- `address_id`
- `currency_code`
- `transaction_id`

Cross-report connection value:
- Good pragmatic reference for generic business reports because it approximates what analysts see in CRM, ERP, customer service, and operational exports.

## 38. Education Standards: CEDS, Ed-Fi, IPEDS, and Caliper

Source(s):
- CEDS glossary: `https://ceds.ed.gov/Glossary.aspx`
- Ed-Fi Data Standard: `https://docs.ed-fi.org/reference/data-exchange/data-standard/`
- IPEDS: `https://nces.ed.gov/ipeds`
- IMS Caliper Analytics: `https://www.imsglobal.org/spec/caliper/v1p2`

Use for:
- K-12 and higher-education entities, student demographics, enrollment, assessment, learning events, institutional reporting, staffing, finance, and completions.

Core objects / role families:
- Student.
- Person.
- Staff.
- Teacher.
- School.
- Local education agency.
- Institution.
- Course.
- Section.
- Program.
- Enrollment.
- Attendance.
- Assessment.
- Learning activity.
- Learning event.
- Credential.
- Completion.
- Financial aid.
- Institutional finance.

Candidate NakliData roles:
- `student_id`
- `staff_id`
- `teacher_id`
- `school_id`
- `district_id`
- `institution_id`
- `course_id`
- `section_id`
- `program_id`
- `enrollment_id`
- `attendance_status`
- `assessment_id`
- `assessment_score`
- `learning_activity_id`
- `learning_event_type`
- `credential_id`
- `completion_status`
- `financial_aid_amount`
- `tuition_amount`
- `institution_finance_metric`

Cross-report connection value:
- Lets analyst reports link learning outcomes, demographics, finance, staffing, attendance, and institutional KPIs.

## 39. OMOP Common Data Model

Source(s):
- OHDSI OMOP Common Data Model: `https://ohdsi.github.io/CommonDataModel/cdm60.html`

Use for:
- Observational health data, patient-centered clinical events, visits, conditions, drugs, procedures, measurements, observations, providers, care sites, and costs.

Core objects / role families:
- Person.
- Visit occurrence.
- Condition occurrence.
- Drug exposure.
- Procedure occurrence.
- Measurement.
- Observation.
- Device exposure.
- Provider.
- Care site.
- Payer plan period.
- Cost.
- Death.
- Vocabulary concept.

Candidate NakliData roles:
- `patient_id`
- `person_id`
- `visit_id`
- `visit_start`
- `visit_end`
- `condition_id`
- `condition_code`
- `drug_id`
- `drug_code`
- `procedure_id`
- `procedure_code`
- `measurement_id`
- `measurement_value`
- `observation_id`
- `device_id`
- `provider_id`
- `care_site_id`
- `payer_plan_id`
- `cost_amount`
- `death_date`
- `clinical_concept_id`

Cross-report connection value:
- Bridges clinical, claims, lab, provider, cost, quality, and population-health reports around patient events and standard vocabularies.

## 40. CDISC SDTM, ADaM, and Define-XML

Source(s):
- CDISC SDTM: `https://www.cdisc.org/standards/foundational/sdtm`
- CDISC standards catalog: `https://www.cdisc.org/standards`

Use for:
- Clinical trial submissions, study domains, subject-level events, interventions, findings, relationships, analysis datasets, and metadata.

Core objects / role families:
- Study.
- Subject.
- Domain.
- Trial design.
- Demographics.
- Exposure.
- Adverse event.
- Concomitant medication.
- Medical history.
- Disposition.
- Lab test.
- Vital sign.
- Finding.
- Event.
- Intervention.
- Analysis parameter.
- Analysis value.
- Dataset metadata.

Candidate NakliData roles:
- `study_id`
- `site_id`
- `subject_id`
- `domain_code`
- `visit_name`
- `visit_number`
- `treatment_arm`
- `exposure_id`
- `adverse_event_id`
- `adverse_event_term`
- `medication_id`
- `lab_test_code`
- `lab_result_value`
- `vital_sign_code`
- `finding_value`
- `analysis_parameter`
- `analysis_value`
- `dataset_metadata_id`

Cross-report connection value:
- Useful for clinical research analysts who need consistent summaries across trial safety, efficacy, enrollment, site operations, and regulatory datasets.

## 41. LOINC and SNOMED CT

Source(s):
- LOINC: `https://loinc.org/`
- SNOMED CT overview: `https://www.snomed.org/what-is-snomed-ct`

Use for:
- Clinical observations, lab tests, health measurements, documents, diagnoses, procedures, body structures, organisms, substances, and clinical findings.

Core objects / role families:
- Lab observation.
- Measurement.
- Document type.
- Clinical finding.
- Procedure.
- Body structure.
- Organism.
- Substance.
- Qualifier.
- Observable entity.
- Specimen.
- Method.
- Component.
- System.
- Scale.
- Timing.

Candidate NakliData roles:
- `loinc_code`
- `snomed_code`
- `clinical_code`
- `clinical_term`
- `lab_test_name`
- `lab_component`
- `specimen_type`
- `measurement_system`
- `measurement_method`
- `measurement_scale`
- `measurement_timing`
- `clinical_finding`
- `procedure_code`
- `body_site`
- `organism`
- `substance`
- `document_type`

Cross-report connection value:
- Adds deep healthcare semantics that generic `measurement` or `diagnosis` roles cannot express on their own.

## 42. ACORD Insurance Standards

Source(s):
- ACORD Data Standards: `https://www.acord.org/standards-architecture/acord-data-standards`

Use for:
- Insurance policies, claims, parties, coverages, risks, underwriting, producers, benefits, accounting, settlement, and reinsurance-style exchanges.

Core objects / role families:
- Policy.
- Claim.
- Insured.
- Policyholder.
- Producer.
- Carrier.
- Coverage.
- Risk.
- Exposure.
- Premium.
- Deductible.
- Limit.
- Loss.
- Incident.
- Payment.
- Reserve.
- Benefit.
- Commission.

Candidate NakliData roles:
- `policy_id`
- `claim_id`
- `insured_id`
- `policyholder_id`
- `producer_id`
- `carrier_id`
- `coverage_type`
- `risk_type`
- `exposure_value`
- `premium_amount`
- `deductible_amount`
- `limit_amount`
- `loss_date`
- `loss_amount`
- `incident_id`
- `claim_payment_amount`
- `reserve_amount`
- `benefit_amount`
- `commission_amount`

Cross-report connection value:
- Connects claims, policy, risk, customer, producer, payment, finance, and actuarial reporting.

## 43. FIX Protocol

Source(s):
- FIX Trading Community standards: `https://fixtrading.org/standards/fix-protocol/`
- FIXimate field dictionary: `https://fiximate.fixtrading.org/en/FIX.Latest/fields_sorted_by_tagnum.html`

Use for:
- Securities trading messages, orders, executions, allocations, market data, instruments, counterparties, and trade lifecycle events.

Core objects / role families:
- Message.
- Order.
- Execution report.
- Trade.
- Allocation.
- Instrument.
- Security.
- Party.
- Account.
- Price.
- Quantity.
- Side.
- Order type.
- Time in force.
- Venue.
- Market data quote.

Candidate NakliData roles:
- `message_type`
- `message_timestamp`
- `order_id`
- `client_order_id`
- `execution_id`
- `trade_id`
- `allocation_id`
- `instrument_id`
- `security_id`
- `symbol`
- `party_id`
- `account_id`
- `price`
- `quantity`
- `side`
- `order_type`
- `time_in_force`
- `venue_id`
- `quote_id`

Cross-report connection value:
- Lets transaction-cost, risk, compliance, operations, market-data, and client reporting share a trading-event grammar.

## 44. LEI and GLEIF Common Data File

Source(s):
- GLEIF LEI CDF format: `https://www.gleif.org/en/lei-data/access-and-use-lei-data/level-1-data-lei-cdf-3-1-format`

Use for:
- Legal entity identity, registration, headquarters, legal address, entity status, registration status, and "who is who" reference data.

Core objects / role families:
- Legal entity.
- Legal name.
- Other name.
- LEI.
- Entity status.
- Legal form.
- Registration authority.
- Registration identifier.
- Legal address.
- Headquarters address.
- Jurisdiction.
- Managing LOU.
- Validation source.

Candidate NakliData roles:
- `lei`
- `legal_entity_id`
- `legal_entity_name`
- `legal_form`
- `entity_status`
- `registration_status`
- `registration_authority`
- `registration_identifier`
- `legal_address`
- `headquarters_address`
- `jurisdiction`
- `managing_lou`
- `validation_source`
- `entity_expiration_date`

Cross-report connection value:
- A high-value join key for vendor, counterparty, bank, issuer, customer, procurement, compliance, and sanctions-style reporting.

## 45. Open311 GeoReport

Source(s):
- Open311 GeoReport v2: `https://wiki.open311.org/GeoReport_v2/`
- Open311 bulk API: `https://wiki.open311.org/GeoReport/bulk`

Use for:
- Civic service requests, issue categories, request status, agencies, locations, media, timestamps, and public works / municipal operations.

Core objects / role families:
- Service request.
- Service code.
- Service name.
- Service definition.
- Agency.
- Jurisdiction.
- Status.
- Requested datetime.
- Updated datetime.
- Expected datetime.
- Address.
- Coordinate.
- Description.
- Media URL.
- Attribute.

Candidate NakliData roles:
- `service_request_id`
- `service_code`
- `service_name`
- `agency_id`
- `jurisdiction_id`
- `request_status`
- `requested_at`
- `updated_at`
- `expected_at`
- `closed_at`
- `address`
- `latitude`
- `longitude`
- `description`
- `media_url`
- `request_attribute`

Cross-report connection value:
- Connects resident complaints, field operations, asset maintenance, department workload, geography, and service-level reporting.

## 46. NENA NG9-1-1 GIS Data Model

Source(s):
- NENA NG9-1-1 GIS Data Model: `https://cdn.ymaws.com/www.nena.org/resource/resmgr/standards/nena-sta-006.2a_ng9-1-1_gis_.pdf`

Use for:
- Emergency service GIS layers, location validation, routing, PSAP boundaries, response agency boundaries, road centerlines, address points, and emergency service zones.

Core objects / role families:
- Road centerline.
- Address point.
- Site structure address point.
- PSAP boundary.
- Emergency service boundary.
- Fire response boundary.
- Law response boundary.
- EMS response boundary.
- Provisioning boundary.
- Street name.
- Civic address.
- Service area.
- Validation rule.

Candidate NakliData roles:
- `address_point_id`
- `road_centerline_id`
- `street_name`
- `house_number`
- `civic_address`
- `psap_id`
- `psap_boundary`
- `fire_response_area`
- `law_response_area`
- `ems_response_area`
- `emergency_service_zone`
- `service_boundary`
- `routing_boundary`
- `location_validation_status`

Cross-report connection value:
- Obscure but powerful for public safety reports that need to join incidents, response times, call routing, roads, addresses, and agency boundaries.

## 47. NIST Election Results Reporting CDF

Source(s):
- NIST Election Results Reporting Common Data Format: `https://pages.nist.gov/ElectionResultsReporting/`

Use for:
- Election setup, contests, candidates, ballot measures, vote counts, reporting units, precincts, parties, offices, and post-election results.

Core objects / role families:
- Election.
- Election report.
- Contest.
- Candidate.
- Ballot selection.
- Ballot measure.
- Office.
- Party.
- Reporting unit.
- Precinct.
- Vote count.
- Vote type.
- Count status.
- Geographic scope.

Candidate NakliData roles:
- `election_id`
- `election_date`
- `contest_id`
- `contest_name`
- `candidate_id`
- `candidate_name`
- `party_id`
- `party_name`
- `office_id`
- `ballot_measure_id`
- `reporting_unit_id`
- `precinct_id`
- `vote_count`
- `vote_type`
- `count_status`
- `geographic_scope`

Cross-report connection value:
- Supports civic reports that join election results to geography, demographics, turnout, finance, media, and administrative operations.

## 48. HR Open Standards

Source(s):
- HR Open Standards: `https://www.hropenstandards.org/`

Use for:
- HR data exchange across recruiting, hiring, onboarding, payroll, benefits, compensation, performance, wellness, and workforce administration.

Core objects / role families:
- Person.
- Worker.
- Candidate.
- Position.
- Job requisition.
- Employment.
- Organization.
- Compensation.
- Payroll.
- Benefit.
- Deduction.
- Time entry.
- Leave.
- Performance.
- Credential.
- Skill.

Candidate NakliData roles:
- `worker_id`
- `candidate_id`
- `employee_id`
- `position_id`
- `job_requisition_id`
- `employment_status`
- `department_id`
- `manager_id`
- `compensation_amount`
- `payroll_period`
- `benefit_plan_id`
- `deduction_amount`
- `time_entry_hours`
- `leave_type`
- `performance_rating`
- `credential_id`
- `skill_name`

Cross-report connection value:
- Helps workforce reports connect recruiting, payroll, benefits, headcount, productivity, retention, and performance.

## 49. EU Vocabularies and Authority Tables

Source(s):
- EU Vocabularies controlled vocabularies: `https://op.europa.eu/en/web/eu-vocabularies/controlled-vocabularies`

Use for:
- Official code lists and authority tables for countries, languages, currencies, corporate bodies, file types, legal resource types, places, and EU institutional concepts.

Core objects / role families:
- Authority table.
- Code.
- Label.
- Country.
- Language.
- Currency.
- Corporate body.
- Place.
- File type.
- Legal resource.
- Procedure.
- Status.
- Theme.
- Dataset type.

Candidate NakliData roles:
- `authority_code`
- `authority_label`
- `country_code`
- `language_code`
- `currency_code`
- `corporate_body_id`
- `place_id`
- `file_type`
- `legal_resource_type`
- `procedure_type`
- `status_code`
- `theme_code`
- `dataset_type`

Cross-report connection value:
- Strong reference layer for normalizing public-sector, multilingual, procurement, legal, and international reports.

## 50. CF Climate and Forecast Metadata Conventions

Source(s):
- DCC metadata standards list, including CF Climate and Forecast conventions: `https://www.dcc.ac.uk/guidance/standards/metadata/list`
- CF Conventions home: `https://cfconventions.org/`

Use for:
- Climate, weather, ocean, atmospheric, gridded, and model-output datasets with standard names, axes, coordinates, units, bounds, and cell methods.

Core objects / role families:
- Standard name.
- Variable.
- Coordinate variable.
- Latitude.
- Longitude.
- Vertical coordinate.
- Time coordinate.
- Axis.
- Grid mapping.
- Bounds.
- Cell method.
- Unit.
- Forecast reference time.
- Ensemble member.

Candidate NakliData roles:
- `climate_variable`
- `standard_name`
- `measurement_value`
- `measurement_unit`
- `latitude`
- `longitude`
- `vertical_level`
- `time_coordinate`
- `forecast_reference_time`
- `lead_time`
- `grid_cell_id`
- `grid_mapping`
- `bounds`
- `cell_method`
- `ensemble_member`

Cross-report connection value:
- Lets environmental, insurance, agriculture, infrastructure, utilities, and risk reports connect structured climate variables to assets and geography.

## 51. DataCite

Source(s):
- DataCite Metadata Schema: `https://schema.datacite.org/`

Use for:
- Research datasets, DOIs, creators, contributors, funders, related identifiers, resource types, rights, subjects, dates, and publication metadata.

Core objects / role families:
- Identifier.
- DOI.
- Creator.
- Contributor.
- Publisher.
- Publication year.
- Resource type.
- Subject.
- Funding reference.
- Related identifier.
- Rights.
- Version.
- Geo location.
- Date.

Candidate NakliData roles:
- `doi`
- `resource_id`
- `resource_title`
- `resource_type`
- `creator_name`
- `creator_id`
- `contributor_name`
- `publisher`
- `publication_year`
- `subject`
- `funder_id`
- `funder_name`
- `award_number`
- `related_identifier`
- `rights_uri`
- `version`
- `geo_location`

Cross-report connection value:
- Bridges scholarly, grant, publication, dataset, institutional, and impact reports around persistent research identifiers.

## 52. MARC, BIBFRAME, and Library Metadata

Source(s):
- Library of Congress BIBFRAME: `https://www.loc.gov/bibframe/`
- Library of Congress MARC standards: `https://www.loc.gov/marc/`

Use for:
- Bibliographic records, works, instances, items, creators, subjects, classifications, publishers, holdings, and library inventory.

Core objects / role families:
- Work.
- Instance.
- Item.
- Title.
- Creator.
- Contributor.
- Subject.
- Classification.
- Identifier.
- Publisher.
- Publication place.
- Publication date.
- Language.
- Holding.
- Collection.

Candidate NakliData roles:
- `work_id`
- `instance_id`
- `item_id`
- `title`
- `creator_name`
- `contributor_name`
- `subject`
- `classification_code`
- `isbn`
- `issn`
- `lccn`
- `publisher`
- `publication_place`
- `publication_date`
- `language_code`
- `holding_location`
- `collection_id`

Cross-report connection value:
- Useful for libraries, archives, universities, publishers, cultural institutions, and internal knowledge-base reports.

## 53. OBO Foundry and Domain Ontologies

Source(s):
- OBO Foundry: `https://obofoundry.org/`

Use for:
- Biomedical and biological ontologies spanning anatomy, phenotype, disease, environment, organisms, chemicals, genes, proteins, experiments, and evidence.

Core objects / role families:
- Ontology term.
- Term identifier.
- Preferred label.
- Synonym.
- Definition.
- Parent term.
- Disease.
- Phenotype.
- Anatomy.
- Organism.
- Chemical entity.
- Gene product.
- Evidence.
- Assay.

Candidate NakliData roles:
- `ontology_term_id`
- `ontology_label`
- `ontology_namespace`
- `synonym`
- `definition`
- `parent_term`
- `disease_term`
- `phenotype_term`
- `anatomy_term`
- `organism_term`
- `chemical_term`
- `gene_id`
- `protein_id`
- `evidence_code`
- `assay_type`

Cross-report connection value:
- Gives life-science and health reports a broader reference frame than FHIR/OMOP alone, especially for research datasets and lab outputs.

## 54. FoodOn

Source(s):
- FoodOn: `https://foodon.org/`

Use for:
- Food products, food sources, processing, packaging, culinary forms, ingredients, and food-related classifications.

Core objects / role families:
- Food product.
- Food source.
- Ingredient.
- Process.
- Preservation method.
- Packaging.
- Culinary form.
- Additive.
- Nutrient-related concept.
- Agricultural source.

Candidate NakliData roles:
- `food_product_id`
- `food_product_name`
- `food_category`
- `ingredient`
- `food_source`
- `processing_method`
- `preservation_method`
- `packaging_type`
- `culinary_form`
- `additive`
- `nutrient_name`
- `agricultural_source`

Cross-report connection value:
- Connects agriculture, retail grocery, nutrition, restaurant, supply-chain, inspection, and public-health reports.

## 55. Ecological Metadata Language

Source(s):
- Ecological Metadata Language: `https://eml.ecoinformatics.org/`

Use for:
- Ecology datasets, research projects, sampling methods, study sites, taxonomic coverage, temporal coverage, spatial coverage, attributes, and data tables.

Core objects / role families:
- Dataset.
- Data table.
- Attribute.
- Attribute domain.
- Project.
- Creator.
- Associated party.
- Study site.
- Spatial coverage.
- Temporal coverage.
- Taxonomic coverage.
- Method.
- Sampling protocol.
- Instrument.
- Unit.

Candidate NakliData roles:
- `dataset_id`
- `data_table_id`
- `attribute_name`
- `attribute_domain`
- `project_id`
- `creator_id`
- `associated_party`
- `study_site_id`
- `spatial_coverage`
- `temporal_coverage`
- `taxonomic_coverage`
- `method_name`
- `sampling_protocol`
- `instrument_id`
- `measurement_unit`

Cross-report connection value:
- Useful for connecting environmental observations, biodiversity inventories, field research, climate, agriculture, and conservation reports.

## 56. OGC SensorThings API

Source(s):
- OGC SensorThings API: `https://www.ogc.org/standard/sensorthings/`

Use for:
- Web-native IoT observations with things, locations, datastreams, sensors, observed properties, observations, features of interest, and tasks.

Core objects / role families:
- Thing.
- Location.
- Historical location.
- Datastream.
- Sensor.
- Observed property.
- Observation.
- Feature of interest.
- Tasking capability.
- Actuator.

Candidate NakliData roles:
- `thing_id`
- `thing_name`
- `location_id`
- `location_name`
- `datastream_id`
- `sensor_id`
- `observed_property`
- `observation_id`
- `observation_result`
- `observation_time`
- `feature_of_interest`
- `task_id`
- `actuator_id`

Cross-report connection value:
- A practical API-shaped counterpart to SSN/SOSA, useful when ingesting live or exported IoT data from smart cities, factories, buildings, and environmental networks.

## Coverage comparison

### Strongly covered by current NakliData backlog

- Practical analyst report roles.
- Generic IDs, names, dates, amounts, categories.
- Logs and product analytics.
- Marketplace/listing data.
- Retail and finance basics.
- Broad business domains.
- Report-template linkage.

### Stronger in external source families

- Knowledge organization and crosswalks: SKOS.
- Person, agent, and organization graphs: FOAF, W3C ORG, Registered Organization, LEI.
- PII and sensitive data: Purview, Google Sensitive Data Protection, Presidio.
- Dataset/resource metadata: Dublin Core, DCAT.
- Field constraints: Frictionless, JSON Schema.
- Governance taxonomy: OpenMetadata.
- Semantic modeling: dbt Semantic Layer.
- Data quality: Great Expectations.
- Lineage/provenance: OpenLineage, PROV.
- Multidimensional statistics: SDMX, RDF Data Cube, QB4ST.
- Spatial modeling: OpenStreetMap, GeoSPARQL, CityGML, INSPIRE.
- Sensor and IoT observations: SSN/SOSA, OGC SWE Common, SensorThings API.
- Built environment and facilities: IFC, bSDD, Brick Schema.
- Power, industrial assets, and manufacturing: IEC CIM, MIMOSA, ISA-95/B2MML.
- Healthcare and clinical research: FHIR, OMOP, CDISC, LOINC, SNOMED CT, OBO Foundry.
- Payments, banking, and trading messages: ISO 20022, FIX.
- Insurance: ACORD.
- Public contracting: OCDS.
- Public services, elections, and emergency GIS: Open311, NIST ERR CDF, NENA NG9-1-1 GIS.
- Education: CEDS, Ed-Fi, IPEDS, Caliper.
- HR data exchange: HR Open Standards.
- Biodiversity/ecology: Darwin Core, EML.
- Climate and forecast metadata: CF conventions.
- Ecommerce offer semantics: GoodRelations.
- Human services: Open Referral HSDS.
- Food and nutrition classification: FoodOn.
- Research/library metadata: DataCite, MARC, BIBFRAME.
- Transit/mobility: GTFS.
- Financial statements: XBRL.
- Official vocabularies and authority tables: EU Vocabularies.

### Missing or thin in current NakliData backlog

- Credentials/secrets and cloud keys.
- Country-specific IDs beyond India.
- Dataset catalog/distribution/source metadata.
- Source-specific code-list and synonym handling.
- Person/organization relationship graphs beyond simple IDs.
- Explicit entity/dimension/measure/meta-role layer.
- Data-quality expectation mapping.
- Provenance graph terms.
- Spatial geometry, topology, and 3D/city object roles.
- Sensor/IoT observation models and feature-of-interest terms.
- Built-environment object and facilities-operation roles.
- Utility grid and industrial asset lifecycle terms.
- Manufacturing execution and batch/lot semantics.
- Detailed healthcare/claims roles.
- Clinical trial and research dataset roles.
- Deep banking/payment role structure.
- Trading/order/execution semantics.
- Insurance policy/claim/coverage roles.
- Public contracting lifecycle.
- Civic service requests, emergency-service boundaries, and election results.
- Education and workforce standards.
- Biodiversity/field observation data.
- Ecology, climate, food, and agriculture-specialized vocabularies.
- Library, archive, research-output, and DOI metadata.
- Human-services eligibility/accessibility/schedules.
- Transit schedules.
- Official-statistics cube dimensions.
- Accounting taxonomy/financial statement concepts.

## Suggested universal ontology model

Eventually store universal terms separately from product taxonomy:

```text
UniversalTerm
  id
  source
  source_uri
  label
  description
  aliases
  parent_terms
  related_terms
  equivalent_terms
  narrower_terms
  broader_terms
  value_shape
  detector_hints
  sensitivity_hint
  naklidata_role_mapping
  report_affordance_mapping
  confidence_notes
```

Recommended mapping layers:

- `source_term` -> `universal_term`
- `universal_term` -> `naklidata_semantic_role`
- `naklidata_semantic_role` -> `report_template_slot`
- `semantic_role` -> `quality_expectations`
- `semantic_role` -> `sensitivity_strategy`

This lets NakliData stay small and practical while still being able to connect reports through a richer universal graph later.
