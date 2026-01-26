import { flowers, gift, graph, people, trophy } from "../../assets/images"

const IndividualCompetitionHeroCardsInfo = () => {
  return (
    <>
      {/* Desktop layout - all 5 cards in a row */}
      <div className="hidden xl:grid xl:grid-cols-5 gap-4">
        <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
            <img src={trophy} alt="trophy" className="mx-auto"/>
            <p className='sequel-45 text-sm text-white mt-4'>LOW MINIMUM ENTRY COST</p>
        </div>
         <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
            <img src={graph} alt="graph" className="mx-auto"/>
            <p className='sequel-45 text-sm text-white mt-4'>LIMITED TOTAL ENTRIES</p>
        </div>
         <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
            <img src={flowers} alt="flowers" className="mx-auto"/>
            <p className='sequel-45 text-sm text-white mt-4'>FAIR ENTRY LIMIT</p>
        </div>
         <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
            <img src={people} alt="people" className="mx-auto"/>
            <p className='sequel-45 text-sm text-white mt-4'>VRF FOR ALL</p>
        </div>
         <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
            <img src={gift} alt="gift" className="mx-auto"/>
            <p className='sequel-45 text-sm text-white mt-4'>LIVE PRIZES EVERY WEEK</p>
        </div>
      </div>

      {/* Mobile/Tablet layout - 4 cards in 2x2 grid, Total Prizes full width below */}
      <div className="xl:hidden flex flex-col gap-4">
        <div className="grid md:grid-cols-3 grid-cols-2 gap-4">
          <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
              <img src={trophy} alt="trophy" className="mx-auto"/>
              <p className='sequel-45 text-sm text-white mt-4'>LOW MINIMUM ENTRY COST</p>
          </div>
           <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
              <img src={graph} alt="graph" className="mx-auto"/>
              <p className='sequel-45 text-sm text-white mt-4'>LIMITED TOTAL ENTRIES</p>
          </div>
           <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
              <img src={flowers} alt="flowers" className="mx-auto"/>
              <p className='sequel-45 text-sm text-white mt-4'>FAIR ENTRY LIMIT</p>
          </div>
           <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
              <img src={people} alt="people" className="mx-auto"/>
              <p className='sequel-45 text-sm text-white mt-4'>VRF FOR ALL</p>
          </div>
        </div>
        {/* Total Prizes - full width on mobile */}
        <div className='bg-[#323232] rounded-xl custom-box-shadow text-center py-3'>
            <img src={gift} alt="gift" className="mx-auto"/>
            <p className='sequel-45 text-sm text-white mt-4'>LIVE PRIZES EVERY WEEK</p>
        </div>
      </div>
    </>
  )
}

export default IndividualCompetitionHeroCardsInfo
