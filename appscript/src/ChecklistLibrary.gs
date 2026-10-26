/**
 * The airline catering health & safety checklist, as shipped.
 *
 * Item codes such as S02.G01.I07 are permanent identities. A unit may reword an
 * item, but it keeps its library id, which is what lets recurrence detection and
 * cross-unit comparison still line up afterwards.
 *
 * Generated from server/src/db/library/checklist-v1.json - do not edit by hand.
 */
const CHECKLIST_LIBRARY = [
  {
    "code": "S01",
    "title": "GENERAL HEALTH & SAFETY – ALL DEPARTMENTS",
    "applies_to": "all_departments",
    "groups": [
      {
        "code": "S01.G01",
        "title": "Personal Protective Equipment",
        "items": [
          [
            "S01.G01.I01",
            "Required PPE is clearly identified for the work area."
          ],
          [
            "S01.G01.I02",
            "Employees wear appropriate safety footwear."
          ],
          [
            "S01.G01.I03",
            "Employees wear required gloves, aprons, hair/beard protection, eye/face protection and hearing protection where applicable."
          ],
          [
            "S01.G01.I04",
            "PPE is clean, undamaged and properly maintained."
          ],
          [
            "S01.G01.I05",
            "Employees know when and how to use PPE."
          ],
          [
            "S01.G01.I06",
            "Damaged PPE is replaced immediately."
          ]
        ]
      },
      {
        "code": "S01.G02",
        "title": "Housekeeping & Workplace Conditions",
        "items": [
          [
            "S01.G02.I01",
            "Floors are clean, dry and free from grease, food debris and obstructions."
          ],
          [
            "S01.G02.I02",
            "Walkways and emergency exits are unobstructed."
          ],
          [
            "S01.G02.I03",
            "Emergency exits are clearly marked and accessible."
          ],
          [
            "S01.G02.I04",
            "Adequate lighting is provided."
          ],
          [
            "S01.G02.I05",
            "Work areas are adequately ventilated."
          ],
          [
            "S01.G02.I06",
            "No exposed electrical cables or damaged electrical equipment."
          ],
          [
            "S01.G02.I07",
            "Spillages are cleaned immediately."
          ],
          [
            "S01.G02.I08",
            "Waste is removed regularly."
          ],
          [
            "S01.G02.I09",
            "Storage does not create falling-object hazards."
          ],
          [
            "S01.G02.I10",
            "Doors, stairs, ramps and handrails are in good condition."
          ],
          [
            "S01.G02.I11",
            "Anti-slip measures are effective in wet areas."
          ]
        ]
      },
      {
        "code": "S01.G03",
        "title": "Emergency Preparedness",
        "items": [
          [
            "S01.G03.I01",
            "Emergency procedures are posted and understood by employees."
          ],
          [
            "S01.G03.I02",
            "Emergency contact information is available."
          ],
          [
            "S01.G03.I03",
            "First-aid kits are accessible and adequately stocked."
          ],
          [
            "S01.G03.I04",
            "Fire extinguishers are accessible and inspected."
          ],
          [
            "S01.G03.I05",
            "Fire alarm/pull stations are unobstructed."
          ],
          [
            "S01.G03.I06",
            "Employees know evacuation routes and assembly points."
          ],
          [
            "S01.G03.I07",
            "Emergency lighting is functional."
          ],
          [
            "S01.G03.I08",
            "Incident reporting procedures are understood."
          ],
          [
            "S01.G03.I09",
            "Near misses are reported and investigated."
          ],
          [
            "S01.G03.I10",
            "Corrective actions from previous incidents have been completed."
          ]
        ]
      },
      {
        "code": "S01.G04",
        "title": "Employee Safety",
        "items": [
          [
            "S01.G04.I01",
            "Employees have received required Health & Safety training."
          ],
          [
            "S01.G04.I02",
            "New employees receive appropriate orientation."
          ],
          [
            "S01.G04.I03",
            "Employees understand safe operating procedures."
          ],
          [
            "S01.G04.I04",
            "Unsafe acts are corrected immediately."
          ],
          [
            "S01.G04.I05",
            "Employees know how to report hazards."
          ],
          [
            "S01.G04.I06",
            "No horseplay or unsafe behavior observed."
          ],
          [
            "S01.G04.I07",
            "Fatigue-related risks are managed."
          ],
          [
            "S01.G04.I08",
            "Employees working alone have appropriate controls."
          ],
          [
            "S01.G04.I09",
            "Workplace violence/harassment procedures are communicated."
          ],
          [
            "S01.G04.I10",
            "Employees know emergency stop procedures for applicable equipment."
          ]
        ]
      }
    ]
  },
  {
    "code": "S02",
    "title": "KITCHEN – HOT PRODUCTION",
    "applies_to": "department",
    "groups": [
      {
        "code": "S02.G01",
        "title": "Hot Equipment",
        "items": [
          [
            "S02.G01.I01",
            "Ovens are in safe working condition."
          ],
          [
            "S02.G01.I02",
            "Steamers are functioning safely."
          ],
          [
            "S02.G01.I03",
            "Fryers are properly maintained."
          ],
          [
            "S02.G01.I04",
            "Stoves/hot plates are free from excessive grease."
          ],
          [
            "S02.G01.I05",
            "Hot holding equipment is stable and accessible."
          ],
          [
            "S02.G01.I06",
            "Guards and protective covers are in place."
          ],
          [
            "S02.G01.I07",
            "Emergency shut-off controls are accessible."
          ],
          [
            "S02.G01.I08",
            "Employees are trained on hot equipment."
          ]
        ]
      },
      {
        "code": "S02.G02",
        "title": "Burns & Scalding",
        "items": [
          [
            "S02.G02.I01",
            "Appropriate heat-resistant gloves are available."
          ],
          [
            "S02.G02.I02",
            "Employees use appropriate tools for handling hot trays."
          ],
          [
            "S02.G02.I03",
            "Hot liquids are transported safely."
          ],
          [
            "S02.G02.I04",
            "Containers are not overfilled."
          ],
          [
            "S02.G02.I05",
            "Hot trays are placed in designated locations."
          ],
          [
            "S02.G02.I06",
            "Hot surfaces are identified where necessary."
          ],
          [
            "S02.G02.I07",
            "Steam exposure is controlled when opening ovens/steamers."
          ],
          [
            "S02.G02.I08",
            "Employees understand burn/scald first-aid procedures."
          ]
        ]
      },
      {
        "code": "S02.G03",
        "title": "Knives & Cutting Equipment",
        "items": [
          [
            "S02.G03.I01",
            "Knives are sharp and properly maintained."
          ],
          [
            "S02.G03.I02",
            "Knives are stored safely."
          ],
          [
            "S02.G03.I03",
            "Cutting boards are stable."
          ],
          [
            "S02.G03.I04",
            "Employees use knives correctly."
          ],
          [
            "S02.G03.I05",
            "Cut-resistant gloves are available where required."
          ],
          [
            "S02.G03.I06",
            "Mechanical slicers/cutters have guards installed."
          ],
          [
            "S02.G03.I07",
            "Equipment is isolated before cleaning or maintenance."
          ]
        ]
      },
      {
        "code": "S02.G04",
        "title": "Manual Handling",
        "items": [
          [
            "S02.G04.I01",
            "Heavy pots/trays are handled using appropriate equipment."
          ],
          [
            "S02.G04.I02",
            "Two-person lifting is used where required."
          ],
          [
            "S02.G04.I03",
            "Trolleys/carts are available for heavy loads."
          ],
          [
            "S02.G04.I04",
            "Employees use safe lifting techniques."
          ],
          [
            "S02.G04.I05",
            "Frequently handled items are stored between appropriate heights."
          ]
        ]
      },
      {
        "code": "S02.G05",
        "title": "Kitchen Environment",
        "items": [
          [
            "S02.G05.I01",
            "Floors are non-slip and free of grease."
          ],
          [
            "S02.G05.I02",
            "Extraction/ventilation systems are functioning."
          ],
          [
            "S02.G05.I03",
            "Gas/electrical connections are safe."
          ],
          [
            "S02.G05.I04",
            "Cleaning chemicals are properly labelled."
          ],
          [
            "S02.G05.I05",
            "Chemical containers are stored away from food."
          ],
          [
            "S02.G05.I06",
            "Waste containers are stable and accessible."
          ]
        ]
      }
    ]
  },
  {
    "code": "S03",
    "title": "KITCHEN – COLD PRODUCTION",
    "applies_to": "department",
    "groups": [
      {
        "code": "S03.G01",
        "title": "",
        "items": [
          [
            "S03.G01.I01",
            "Floors are clean, dry and non-slip."
          ],
          [
            "S03.G01.I02",
            "Refrigerated work areas are maintained safely."
          ],
          [
            "S03.G01.I03",
            "Cold-room doors and emergency releases function correctly."
          ],
          [
            "S03.G01.I04",
            "Employees have appropriate protection when working in cold environments."
          ],
          [
            "S03.G01.I05",
            "Cutting knives are stored safely."
          ],
          [
            "S03.G01.I06",
            "Food processors/mixers have guards installed."
          ],
          [
            "S03.G01.I07",
            "Equipment is switched off before cleaning."
          ],
          [
            "S03.G01.I08",
            "Electrical equipment is free from damaged cords."
          ],
          [
            "S03.G01.I09",
            "Heavy ingredients are stored safely."
          ],
          [
            "S03.G01.I10",
            "Employees use carts/trolleys for heavy loads."
          ],
          [
            "S03.G01.I11",
            "Workstations are ergonomically appropriate."
          ],
          [
            "S03.G01.I12",
            "No excessive reaching, twisting or awkward postures observed."
          ],
          [
            "S03.G01.I13",
            "Spillages are cleaned immediately."
          ],
          [
            "S03.G01.I14",
            "Emergency exits remain accessible."
          ]
        ]
      }
    ]
  },
  {
    "code": "S04",
    "title": "MAKE & PACK – TRAY SETUP",
    "applies_to": "department",
    "groups": [
      {
        "code": "S04.G01",
        "title": "Ergonomics & Repetitive Work",
        "items": [
          [
            "S04.G01.I01",
            "Workstations are at appropriate working height."
          ],
          [
            "S04.G01.I02",
            "Employees are not required to excessively bend or reach."
          ],
          [
            "S04.G01.I03",
            "Repetitive tasks are appropriately rotated where possible."
          ],
          [
            "S04.G01.I04",
            "Adequate breaks/rest periods are provided."
          ],
          [
            "S04.G01.I05",
            "Employees report ergonomic discomfort."
          ],
          [
            "S04.G01.I06",
            "Heavy items are positioned within safe reach."
          ]
        ]
      },
      {
        "code": "S04.G02",
        "title": "Tray Assembly",
        "items": [
          [
            "S04.G02.I01",
            "Trays are handled safely."
          ],
          [
            "S04.G02.I02",
            "Sharp utensils are positioned safely."
          ],
          [
            "S04.G02.I03",
            "Broken/cracked trays or equipment are removed."
          ],
          [
            "S04.G02.I04",
            "Work surfaces are stable."
          ],
          [
            "S04.G02.I05",
            "No excessive stacking of trays."
          ],
          [
            "S04.G02.I06",
            "Trays do not obstruct walkways."
          ],
          [
            "S04.G02.I07",
            "Employees use appropriate gloves where required."
          ]
        ]
      },
      {
        "code": "S04.G03",
        "title": "Trolley Filling",
        "items": [
          [
            "S04.G03.I01",
            "Trolleys are inspected before use."
          ],
          [
            "S04.G03.I02",
            "Wheels and brakes function correctly."
          ],
          [
            "S04.G03.I03",
            "Trolley doors/latches operate properly."
          ],
          [
            "S04.G03.I04",
            "Trolleys are not overloaded."
          ],
          [
            "S04.G03.I05",
            "Weight is distributed safely."
          ],
          [
            "S04.G03.I06",
            "Heavy items are placed at appropriate heights."
          ],
          [
            "S04.G03.I07",
            "Trolleys are pushed rather than pulled where practicable."
          ],
          [
            "S04.G03.I08",
            "Employees maintain clear visibility when moving trolleys."
          ],
          [
            "S04.G03.I09",
            "Trolleys are not left blocking exits or walkways."
          ],
          [
            "S04.G03.I10",
            "Damaged trolleys are tagged and removed from service."
          ]
        ]
      }
    ]
  },
  {
    "code": "S05",
    "title": "WAREHOUSE",
    "applies_to": "department",
    "groups": [
      {
        "code": "S05.G01",
        "title": "Storage & Racking",
        "items": [
          [
            "S05.G01.I01",
            "Racking is structurally sound."
          ],
          [
            "S05.G01.I02",
            "Rack load limits are clearly identified."
          ],
          [
            "S05.G01.I03",
            "Heavy items are stored on lower levels."
          ],
          [
            "S05.G01.I04",
            "Items are stable and cannot fall."
          ],
          [
            "S05.G01.I05",
            "Pallets are in good condition."
          ],
          [
            "S05.G01.I06",
            "Damaged pallets are removed."
          ],
          [
            "S05.G01.I07",
            "Aisles remain clear."
          ],
          [
            "S05.G01.I08",
            "Emergency exits are unobstructed."
          ],
          [
            "S05.G01.I09",
            "No unstable stacking."
          ]
        ]
      },
      {
        "code": "S05.G02",
        "title": "Material Handling",
        "items": [
          [
            "S05.G02.I01",
            "Pallet jacks are inspected before use."
          ],
          [
            "S05.G02.I02",
            "Powered equipment is operated only by authorized/trained employees."
          ],
          [
            "S05.G02.I03",
            "Pedestrian and equipment traffic is adequately separated."
          ],
          [
            "S05.G02.I04",
            "Employees maintain safe distances from moving equipment."
          ],
          [
            "S05.G02.I05",
            "Loads do not obstruct operator visibility."
          ],
          [
            "S05.G02.I06",
            "Loads are secured before movement."
          ],
          [
            "S05.G02.I07",
            "Dock plates/ramps are secure."
          ],
          [
            "S05.G02.I08",
            "Loading docks have appropriate edge protection."
          ],
          [
            "S05.G02.I09",
            "Employees do not stand under suspended loads."
          ]
        ]
      },
      {
        "code": "S05.G03",
        "title": "Cold Storage/Freezers",
        "items": [
          [
            "S05.G03.I01",
            "Cold-room/freezer doors function correctly."
          ],
          [
            "S05.G03.I02",
            "Emergency release mechanisms are operational."
          ],
          [
            "S05.G03.I03",
            "Appropriate thermal PPE is available."
          ],
          [
            "S05.G03.I04",
            "Floors are free of ice and excessive moisture."
          ],
          [
            "S05.G03.I05",
            "Employees limit exposure to extreme cold."
          ],
          [
            "S05.G03.I06",
            "No blocked emergency exits."
          ]
        ]
      }
    ]
  },
  {
    "code": "S06",
    "title": "POTWASH",
    "applies_to": "department",
    "groups": [
      {
        "code": "S06.G01",
        "title": "",
        "items": [
          [
            "S06.G01.I01",
            "Floors are clean and non-slip."
          ],
          [
            "S06.G01.I02",
            "Water drainage is adequate."
          ],
          [
            "S06.G01.I03",
            "Hot water/steam hazards are controlled."
          ],
          [
            "S06.G01.I04",
            "Employees wear appropriate waterproof PPE."
          ],
          [
            "S06.G01.I05",
            "Heat-resistant gloves are available."
          ],
          [
            "S06.G01.I06",
            "Splash protection is used where required."
          ],
          [
            "S06.G01.I07",
            "Heavy pots/equipment are handled safely."
          ],
          [
            "S06.G01.I08",
            "Employees use carts for heavy items."
          ],
          [
            "S06.G01.I09",
            "Sharp objects are separated from general washing."
          ],
          [
            "S06.G01.I10",
            "Broken glass/utensils are safely removed."
          ],
          [
            "S06.G01.I11",
            "Chemical dispensers are functioning correctly."
          ],
          [
            "S06.G01.I12",
            "Chemicals are correctly labelled."
          ],
          [
            "S06.G01.I13",
            "Safety Data Sheets are accessible."
          ],
          [
            "S06.G01.I14",
            "Employees understand chemical dilution and handling."
          ],
          [
            "S06.G01.I15",
            "Eye-wash facilities are accessible."
          ],
          [
            "S06.G01.I16",
            "Employees do not mix incompatible chemicals."
          ],
          [
            "S06.G01.I17",
            "Machine guards are in place."
          ],
          [
            "S06.G01.I18",
            "Emergency stops are functional."
          ]
        ]
      }
    ]
  },
  {
    "code": "S07",
    "title": "DISHWASHING ROOM",
    "applies_to": "department",
    "groups": [
      {
        "code": "S07.G01",
        "title": "Machinery",
        "items": [
          [
            "S07.G01.I01",
            "Dishwashing machines are properly guarded."
          ],
          [
            "S07.G01.I02",
            "Emergency stops are accessible."
          ],
          [
            "S07.G01.I03",
            "Employees are trained on equipment."
          ],
          [
            "S07.G01.I04",
            "Lockout/tagout procedures are followed during maintenance."
          ],
          [
            "S07.G01.I05",
            "Moving parts are protected."
          ],
          [
            "S07.G01.I06",
            "Conveyor systems are safely operated."
          ],
          [
            "S07.G01.I07",
            "Employees do not reach into moving machinery."
          ],
          [
            "S07.G01.I08",
            "Damaged equipment is removed from service."
          ]
        ]
      },
      {
        "code": "S07.G02",
        "title": "Heat & Chemicals",
        "items": [
          [
            "S07.G02.I01",
            "Steam exposure is controlled."
          ],
          [
            "S07.G02.I02",
            "Hot water lines are protected."
          ],
          [
            "S07.G02.I03",
            "Chemical containers are properly labelled."
          ],
          [
            "S07.G02.I04",
            "Chemical dosing systems function correctly."
          ],
          [
            "S07.G02.I05",
            "Employees wear required PPE."
          ],
          [
            "S07.G02.I06",
            "Eye/face protection is available where required."
          ],
          [
            "S07.G02.I07",
            "Chemical spills are managed according to procedure."
          ],
          [
            "S07.G02.I08",
            "Safety Data Sheets are accessible."
          ]
        ]
      },
      {
        "code": "S07.G03",
        "title": "Slips, Trips & Falls",
        "items": [
          [
            "S07.G03.I01",
            "Floors are adequately drained."
          ],
          [
            "S07.G03.I02",
            "Anti-slip flooring is maintained."
          ],
          [
            "S07.G03.I03",
            "Hoses are not creating trip hazards."
          ],
          [
            "S07.G03.I04",
            "Electrical cords are safely routed."
          ],
          [
            "S07.G03.I05",
            "Water spills are cleaned immediately."
          ],
          [
            "S07.G03.I06",
            "Adequate lighting is provided."
          ]
        ]
      }
    ]
  },
  {
    "code": "S08",
    "title": "INBOUND",
    "applies_to": "department",
    "groups": [
      {
        "code": "S08.G01",
        "title": "Receiving & Unloading",
        "items": [
          [
            "S08.G01.I01",
            "Vehicle loading/unloading procedures are followed."
          ],
          [
            "S08.G01.I02",
            "Dock areas are adequately illuminated."
          ],
          [
            "S08.G01.I03",
            "Vehicles are secured before unloading."
          ],
          [
            "S08.G01.I04",
            "Wheel chocks/restraints are used where required."
          ],
          [
            "S08.G01.I05",
            "Employees remain clear of moving vehicles."
          ],
          [
            "S08.G01.I06",
            "Dock plates are correctly positioned."
          ],
          [
            "S08.G01.I07",
            "Dock edges are protected."
          ],
          [
            "S08.G01.I08",
            "Pallets are stable before movement."
          ],
          [
            "S08.G01.I09",
            "Manual handling procedures are followed."
          ]
        ]
      },
      {
        "code": "S08.G02",
        "title": "Vehicle & Pedestrian Safety",
        "items": [
          [
            "S08.G02.I01",
            "Pedestrian routes are clearly marked."
          ],
          [
            "S08.G02.I02",
            "Vehicle routes are clearly identified."
          ],
          [
            "S08.G02.I03",
            "Employees wear high-visibility PPE where required."
          ],
          [
            "S08.G02.I04",
            "Employees maintain safe distance from reversing vehicles."
          ],
          [
            "S08.G02.I05",
            "Spotters are used where required."
          ],
          [
            "S08.G02.I06",
            "Forklifts/pallet jacks are operated by authorized employees."
          ],
          [
            "S08.G02.I07",
            "Vehicle alarms/lights are functional."
          ]
        ]
      },
      {
        "code": "S08.G03",
        "title": "Incoming Materials",
        "items": [
          [
            "S08.G03.I01",
            "Damaged pallets are isolated."
          ],
          [
            "S08.G03.I02",
            "Falling-object hazards are controlled."
          ],
          [
            "S08.G03.I03",
            "Heavy items are handled using mechanical assistance."
          ],
          [
            "S08.G03.I04",
            "Waste and packaging are removed promptly."
          ],
          [
            "S08.G03.I05",
            "Cold-chain areas are safely accessible."
          ]
        ]
      }
    ]
  },
  {
    "code": "S09",
    "title": "FINAL ASSEMBLY",
    "applies_to": "department",
    "groups": [
      {
        "code": "S09.G01",
        "title": "",
        "items": [
          [
            "S09.G01.I01",
            "Workstations are ergonomically suitable."
          ],
          [
            "S09.G01.I02",
            "Floors are clean and dry."
          ],
          [
            "S09.G01.I03",
            "Trays are handled safely."
          ],
          [
            "S09.G01.I04",
            "Trolleys are inspected before filling."
          ],
          [
            "S09.G01.I05",
            "Trolley wheels/brakes function correctly."
          ],
          [
            "S09.G01.I06",
            "Trolleys are not overloaded."
          ],
          [
            "S09.G01.I07",
            "Employees use safe pushing techniques."
          ],
          [
            "S09.G01.I08",
            "Heavy items are handled with assistance."
          ],
          [
            "S09.G01.I09",
            "Walkways remain clear."
          ],
          [
            "S09.G01.I10",
            "No trolley congestion at workstations."
          ],
          [
            "S09.G01.I11",
            "Sharp utensils are handled safely."
          ],
          [
            "S09.G01.I12",
            "Damaged trays are removed."
          ],
          [
            "S09.G01.I13",
            "Repetitive-motion risks are controlled."
          ],
          [
            "S09.G01.I14",
            "Employees have appropriate PPE."
          ],
          [
            "S09.G01.I15",
            "Emergency exits remain unobstructed."
          ]
        ]
      }
    ]
  },
  {
    "code": "S10",
    "title": "OUTBOUND",
    "applies_to": "department",
    "groups": [
      {
        "code": "S10.G01",
        "title": "Trolley Movement",
        "items": [
          [
            "S10.G01.I01",
            "Trolleys are inspected before leaving the facility."
          ],
          [
            "S10.G01.I02",
            "Wheels and brakes function correctly."
          ],
          [
            "S10.G01.I03",
            "Doors/latches are secured."
          ],
          [
            "S10.G01.I04",
            "Trolleys are not overloaded."
          ],
          [
            "S10.G01.I05",
            "Loads are stable."
          ],
          [
            "S10.G01.I06",
            "Employees maintain visibility while moving trolleys."
          ],
          [
            "S10.G01.I07",
            "Designated pedestrian routes are used."
          ]
        ]
      },
      {
        "code": "S10.G02",
        "title": "Vehicle/Apron Interface",
        "items": [
          [
            "S10.G02.I01",
            "Employees follow airside safety procedures."
          ],
          [
            "S10.G02.I02",
            "High-visibility PPE is worn."
          ],
          [
            "S10.G02.I03",
            "Employees remain alert to aircraft and vehicle movement."
          ],
          [
            "S10.G02.I04",
            "Safe distance from aircraft engines is maintained."
          ],
          [
            "S10.G02.I05",
            "Aircraft exclusion zones are respected."
          ],
          [
            "S10.G02.I06",
            "Ground-support equipment is operated safely."
          ],
          [
            "S10.G02.I07",
            "Vehicle brakes are applied when stationary."
          ],
          [
            "S10.G02.I08",
            "Vehicles are not left unattended in unsafe positions."
          ],
          [
            "S10.G02.I09",
            "Communication with aircraft/ground personnel is maintained."
          ]
        ]
      },
      {
        "code": "S10.G03",
        "title": "Loading Aircraft",
        "items": [
          [
            "S10.G03.I01",
            "Loading equipment is inspected before use."
          ],
          [
            "S10.G03.I02",
            "Lift platforms are stable."
          ],
          [
            "S10.G03.I03",
            "Safety rails/guards are functional."
          ],
          [
            "S10.G03.I04",
            "Employees use appropriate fall protection where required."
          ],
          [
            "S10.G03.I05",
            "Employees maintain three-point contact when climbing."
          ],
          [
            "S10.G03.I06",
            "Trolleys are secured during transport."
          ],
          [
            "S10.G03.I07",
            "No loose objects are left on the apron."
          ],
          [
            "S10.G03.I08",
            "Emergency procedures for aircraft-area incidents are understood."
          ]
        ]
      }
    ]
  },
  {
    "code": "S11",
    "title": "COMMISSARY / GALLEY",
    "applies_to": "department",
    "groups": [
      {
        "code": "S11.G01",
        "title": "Galley Equipment",
        "items": [
          [
            "S11.G01.I01",
            "Galley carts are inspected."
          ],
          [
            "S11.G01.I02",
            "Wheels and brakes function correctly."
          ],
          [
            "S11.G01.I03",
            "Drawers and compartments are secure."
          ],
          [
            "S11.G01.I04",
            "Ovens/food-heating equipment are safe."
          ],
          [
            "S11.G01.I05",
            "Coffee/boiling-water equipment is safe."
          ],
          [
            "S11.G01.I06",
            "Electrical connections are secure."
          ],
          [
            "S11.G01.I07",
            "Emergency shut-offs are accessible."
          ]
        ]
      },
      {
        "code": "S11.G02",
        "title": "Manual Handling",
        "items": [
          [
            "S11.G02.I01",
            "Galley carts are not overloaded."
          ],
          [
            "S11.G02.I02",
            "Heavy items are handled with assistance."
          ],
          [
            "S11.G02.I03",
            "Safe lifting techniques are followed."
          ],
          [
            "S11.G02.I04",
            "Employees avoid awkward twisting/reaching."
          ],
          [
            "S11.G02.I05",
            "Carts are pushed using safe techniques."
          ]
        ]
      },
      {
        "code": "S11.G03",
        "title": "Burns & Cuts",
        "items": [
          [
            "S11.G03.I01",
            "Employees use heat-resistant protection where required."
          ],
          [
            "S11.G03.I02",
            "Hot liquids are transported carefully."
          ],
          [
            "S11.G03.I03",
            "Knives and sharp utensils are stored safely."
          ],
          [
            "S11.G03.I04",
            "Broken glass is immediately isolated and removed."
          ],
          [
            "S11.G03.I05",
            "Hot surfaces are identified."
          ]
        ]
      },
      {
        "code": "S11.G04",
        "title": "Aircraft Environment",
        "items": [
          [
            "S11.G04.I01",
            "Employees follow aircraft access procedures."
          ],
          [
            "S11.G04.I02",
            "Employees maintain three-point contact on aircraft stairs."
          ],
          [
            "S11.G04.I03",
            "Aircraft aisles/exits remain unobstructed."
          ],
          [
            "S11.G04.I04",
            "Galley equipment is secured before aircraft movement."
          ],
          [
            "S11.G04.I05",
            "Employees are aware of aircraft-specific emergency procedures."
          ],
          [
            "S11.G04.I06",
            "Employees follow airside PPE requirements."
          ],
          [
            "S11.G04.I07",
            "No unauthorized equipment/material is left inside the aircraft."
          ]
        ]
      }
    ]
  },
  {
    "code": "S12",
    "title": "CHEMICAL SAFETY – ALL DEPARTMENTS",
    "applies_to": "all_departments",
    "groups": [
      {
        "code": "S12.G01",
        "title": "",
        "items": [
          [
            "S12.G01.I01",
            "All chemical containers are correctly labelled."
          ],
          [
            "S12.G01.I02",
            "Secondary containers are labelled."
          ],
          [
            "S12.G01.I03",
            "Safety Data Sheets are accessible."
          ],
          [
            "S12.G01.I04",
            "Employees are trained in chemical handling."
          ],
          [
            "S12.G01.I05",
            "Appropriate PPE is available."
          ],
          [
            "S12.G01.I06",
            "Chemicals are stored according to compatibility."
          ],
          [
            "S12.G01.I07",
            "Chemicals are never stored in food containers."
          ],
          [
            "S12.G01.I08",
            "Chemicals are separated from food and food-contact materials."
          ],
          [
            "S12.G01.I09",
            "Chemical storage areas are secure."
          ],
          [
            "S12.G01.I10",
            "Spill kits are available."
          ],
          [
            "S12.G01.I11",
            "Chemical exposure procedures are understood."
          ],
          [
            "S12.G01.I12",
            "Eye-wash stations are accessible."
          ],
          [
            "S12.G01.I13",
            "Employees know what to do in case of chemical exposure."
          ]
        ]
      }
    ]
  },
  {
    "code": "S13",
    "title": "ERGONOMICS & MUSCULOSKELETAL RISKS",
    "applies_to": "all_departments",
    "groups": [
      {
        "code": "S13.G01",
        "title": "",
        "items": [
          [
            "S13.G01.I01",
            "Repetitive tasks have been identified."
          ],
          [
            "S13.G01.I02",
            "Heavy lifting activities have been identified."
          ],
          [
            "S13.G01.I03",
            "Awkward postures have been identified."
          ],
          [
            "S13.G01.I04",
            "Pushing/pulling forces are assessed."
          ],
          [
            "S13.G01.I05",
            "Employees receive manual-handling training."
          ],
          [
            "S13.G01.I06",
            "Mechanical aids are available."
          ],
          [
            "S13.G01.I07",
            "Workstations are appropriately adjusted."
          ],
          [
            "S13.G01.I08",
            "Job rotation is used where appropriate."
          ],
          [
            "S13.G01.I09",
            "Employees report pain/discomfort without fear of reprisal."
          ],
          [
            "S13.G01.I10",
            "Ergonomic corrective actions are documented."
          ]
        ]
      }
    ]
  },
  {
    "code": "S14",
    "title": "NOISE & HEARING",
    "applies_to": "all_departments",
    "groups": [
      {
        "code": "S14.G01",
        "title": "",
        "items": [
          [
            "S14.G01.I01",
            "High-noise areas are identified."
          ],
          [
            "S14.G01.I02",
            "Noise exposure is assessed where required."
          ],
          [
            "S14.G01.I03",
            "Hearing protection is available."
          ],
          [
            "S14.G01.I04",
            "Employees wear hearing protection in designated areas."
          ],
          [
            "S14.G01.I05",
            "Equipment generating excessive noise is reported."
          ],
          [
            "S14.G01.I06",
            "Noise-control measures are maintained."
          ]
        ]
      }
    ]
  },
  {
    "code": "S15",
    "title": "ELECTRICAL SAFETY",
    "applies_to": "all_departments",
    "groups": [
      {
        "code": "S15.G01",
        "title": "",
        "items": [
          [
            "S15.G01.I01",
            "Electrical equipment is inspected."
          ],
          [
            "S15.G01.I02",
            "No damaged plugs, cords or outlets."
          ],
          [
            "S15.G01.I03",
            "Extension cords are used appropriately."
          ],
          [
            "S15.G01.I04",
            "Electrical panels are accessible."
          ],
          [
            "S15.G01.I05",
            "Electrical panels are not obstructed."
          ],
          [
            "S15.G01.I06",
            "Employees do not perform unauthorized electrical repairs."
          ],
          [
            "S15.G01.I07",
            "Wet areas have appropriate electrical protection."
          ],
          [
            "S15.G01.I08",
            "Equipment is unplugged/isolated before cleaning where required."
          ]
        ]
      }
    ]
  },
  {
    "code": "S16",
    "title": "FIRE SAFETY",
    "applies_to": "all_departments",
    "groups": [
      {
        "code": "S16.G01",
        "title": "",
        "items": [
          [
            "S16.G01.I01",
            "Fire exits are unobstructed."
          ],
          [
            "S16.G01.I02",
            "Fire doors remain accessible."
          ],
          [
            "S16.G01.I03",
            "Fire extinguishers are accessible."
          ],
          [
            "S16.G01.I04",
            "Fire extinguishers are inspected."
          ],
          [
            "S16.G01.I05",
            "Flammable materials are properly stored."
          ],
          [
            "S16.G01.I06",
            "Grease accumulation is controlled."
          ],
          [
            "S16.G01.I07",
            "Kitchen extraction systems are maintained."
          ],
          [
            "S16.G01.I08",
            "Employees know evacuation procedures."
          ],
          [
            "S16.G01.I09",
            "Emergency assembly areas are known."
          ],
          [
            "S16.G01.I10",
            "Fire drills are conducted according to company requirements."
          ]
        ]
      }
    ]
  }
];
