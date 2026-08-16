// Controllers/FusenApiController.cs
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using DotNetBridge.Data;
using DotNetBridge.Models;
using System.Text.Json;

namespace DotNetBridge.Controllers
{
    [Route("api/fusen")]
    [ApiController]
    public class FusenApiController : ControllerBase
    {
        // 👇 PaymentDbContext ではなく FusenDbContext を使用
        private readonly FusenDbContext _context;

        public FusenApiController(FusenDbContext context)
        {
            _context = context;
        }

        [HttpGet]
        public async Task<IActionResult> Get([FromQuery] string domain)
        {
            if (string.IsNullOrEmpty(domain)) return BadRequest("Domain is required");

            var store = await _context.FusenStores.FirstOrDefaultAsync(f => f.DomainKey == domain);
            
            if (store == null || string.IsNullOrEmpty(store.DataJson))
            {
                return Ok(new { active = new object(), history = new object[0] });
            }

            return Content(store.DataJson, "application/json");
        }

        [HttpPost]
        public async Task<IActionResult> Post([FromQuery] string domain, [FromBody] JsonElement data)
        {
            if (string.IsNullOrEmpty(domain)) return BadRequest("Domain is required");

            var store = await _context.FusenStores.FirstOrDefaultAsync(f => f.DomainKey == domain);
            var jsonString = data.GetRawText();

            if (store == null)
            {
                store = new FusenStore { DomainKey = domain, DataJson = jsonString };
                _context.FusenStores.Add(store);
            }
            else
            {
                store.DataJson = jsonString;
            }

            await _context.SaveChangesAsync();
            return Ok(new { success = true });
        }
    }
}