# Golf Project Context

## Purpose

This project is a golf pool intelligence and recommendation system.

Its purpose is to help Andrew make better weekly golf pool decisions by:
- ingesting league and player data
- incorporating external signals
- generating actionable recommendations
- presenting recommendations in a simple, usable interface

## User Context

- Andrew prefers clear, plain-language explanations and minimal jargon
- the project should save time and improve weekly decisions, not create extra operational burden
- practical usefulness matters more than theoretical sophistication

## Working Constraints

- prefer low operational complexity
- keep costs and dependencies minimal
- favor practical, time-saving solutions over elaborate systems
- keep setup lightweight until usefulness is proven

## Environment Context

### Primary Development Machine
- Mac laptop used for building and editing the project

### Runtime / Hosting Option
- Raspberry Pi 4 available at `androo-pi.local`
- primary Pi user: `andr00`
- use the Pi only when this project needs an actual background runtime or scheduled job

## Primary Use Case

The main use case is weekly pick support for a RunYourPool-style golf pool.

The system should help answer:
- who are the best picks this week
- which picks are safe vs contrarian
- how should recommendations change based on pool context
- what does the current player pool and signal set suggest

## Core Components

### Data
Key project data may include:
- `league_snapshot.json`
- `online_signals.json`
- `player_pool.json`
- `recommendations.json`
- supporting fallback and roadmap data

### Scripts
Scripts are used to:
- fetch and sync external signals
- process league and player data
- generate recommendations
- prepare local build output when needed

### App / UI
The project includes a browser-based UI for viewing:
- recommendations
- standings or league context
- roadmap / planning views
- supporting decision information

### Source Logic
Core recommendation and scoring logic should live in `src/`.

## Product Goal

Build a lightweight, dependable system that improves weekly golf pool decisions without becoming overly complex.

This project should prioritize:
- useful recommendations
- explainable logic
- clean data flow
- maintainable structure

## Product Principles

- usefulness over cleverness
- explainability over black-box logic
- consistency over overfitting
- fast iteration over perfect architecture
- better weekly decisions over excessive feature scope

## Current Architecture Direction

The intended separation is:

- `src/` = core logic and recommendation engine
- `scripts/` = orchestration, ingestion, generation, and utility tasks
- `app/` = UI layer
- `data/` = project data inputs and outputs
- `config/` = project configuration

## Domain Model Direction

This project now uses clearer naming and structure.

Current conceptual separation:
- league = shared pool state, standings, player availability, and the League Dashboard
- selector = Andrew's recommendation logic, picks, and strategy outputs

## Refactor Backlog

Current structure after migration:

- `app/league` contains the League Dashboard source
- `app/selector` contains the Selector source
- the built site preserves `/private/` as a redirect to `/selector/` for compatibility
- future cleanup should continue removing remaining legacy naming assumptions where possible

## Data / Recommendation Priorities

Important recommendation inputs may include:
- player pool availability
- league snapshot context
- online sentiment or signal data
- ownership / popularity implications if available
- player quality, form, and fit signals

## Output Goals

The system should produce recommendations that are:
- actionable
- easy to understand
- useful in real weekly decision-making
- adaptable as data quality improves

## Non-Goals For Early Versions

Avoid overbuilding early versions with:
- excessive deployment complexity
- unnecessary dashboards
- fragile data pipelines
- overly complex scoring models
- automation that does not materially improve weekly picks

## Documentation

- reusable engineering knowledge belongs in the main `knowledgebase` project
- shared reference docs live in `~/Codex/projects/knowledgebase/docs/`
- this repo should stay focused on execution, data, and golf decision support
