// ─── THE CITY PLANNING MANIFEST ──────────────────────────────────────────────
// Every deliberate placement in the world, in one editable file. planet.js
// reads THIS — edit a line here, reload, and the thing moves. Rendered as a
// planning map by `node scripts/render-map.mjs` → city_map.png.
//
// Units: `[lat, lon]` in degrees on the planet. `at: [x, y]` entries are local
// tangent-frame offsets (world units) inside the named frame. Distances/sizes
// are world units (a car ≈ 2 long, a person ≈ 1 tall).
export default {

  // ── planet anchors: the bones of the map ──
  anchors: {
    downtown: [20, -36],       // city plateau centre — everything grid-ish hangs off this
    lake:     [-40, 62],       // the bay (boat fallback moor)
    mountain: [55, -50],       // the overlook mountain
    airport:  [55, 80],        // runway district, well out of town
    mall:     [9, -48],
    farmA:    [46, -12],
    farmB:    [-34, -46],
    resort:   [-14, -66],      // the hotel the arrival limo drives to
    beach:    [-16, -60],      // bay, dock, moored boats
  },

  // ── route stops: train stations + walkable waypoints ──
  stops: {
    central:   [12, 4],        // Central Station (the walk-through GLB station)
    lakeside:  [-26, 58],
    farside:   [6, -168],
    museumst:  [18, -74],
    overlook:  [44, -46],
    boardwalk: [-9, -38],
  },

  // ── project landmarks: the monumental buildings (position only — name,
  //    colour, links stay in planet.js's LANDMARKS table) ──
  landmarks: {
    library:      [14, -8],
    yarnflow:     [24, 22],
    inbox:        [2, 46],
    charterscope: [18, 76],
    deckgpt:      [-8, 100],
    council:      [16, 128],
    brainu:       [-2, 156],
    sinescape:    [12, -176],
    pixels:       [-6, -148],
    ros2:         [14, -120],
    artgarden:    [26, -66],   // the Downtown Museum — tonight's main event
  },

  // ── hero assets: the imported GLB set-pieces ──
  heroes: {
    jetParked:    { frame: 'airport', at: [-3.2, 3],  note: 'NetJets on the apron, nose up-runway' },
    limoApron:    { frame: 'airport', at: [5.2, 12],  note: 'limo waits clear of the runway end' },
    gasStation:   { frame: 'spur:downtown→airport', t: 0.5, side: 2.3, scale: 1.7,
                    note: 'Gas-N-Go halfway down the airport spur; limo pulls onto the slab' },
    trainStation: { frame: 'stop:central', offTrack: -3.0, len: 13.5, lift: 0.32, settleHalf: 3.8,
                    note: 'walk-through station; long axis along the rails' },
    rocketPad:    { frame: 'stop:farside', side: 0.12, note: 'shuttle pad, off the far side stop' },
  },
};
